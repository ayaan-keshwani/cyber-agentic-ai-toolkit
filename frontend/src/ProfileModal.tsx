import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { BusinessProfile } from "./types";
import { boolToTri, normalizeItSupport, triToBool } from "./profileUtils";

function ProfileModal({
  open,
  onClose,
  onSaved,
  onResetComplete,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onResetComplete: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<BusinessProfile | null>(null);
  const [fileSharing, setFileSharing] = useState("");
  const [insuranceUploadBusy, setInsuranceUploadBusy] = useState(false);
  const insuranceFileInputRef = useRef<HTMLInputElement>(null);
  const [baselineJson, setBaselineJson] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState(false);

  const snapshot = (profile: BusinessProfile, fs: string) =>
    JSON.stringify({ p: profile, fileSharing: fs });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBaselineJson(null);
    setPendingClose(false);
    void fetch("/api/profile")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load profile");
        return r.json() as Promise<BusinessProfile>;
      })
      .then((data) => {
        if (cancelled) return;
        const normalized: BusinessProfile = {
          ...data,
          policy_exclusions: data.policy_exclusions ?? "",
          insurance_declarations_original_name:
            data.insurance_declarations_original_name ?? "",
          insurance_declarations_relpath:
            data.insurance_declarations_relpath ?? "",
          it_support: normalizeItSupport(data.it_support ?? ""),
        };
        const fs = (data.uses_file_sharing_solutions ?? []).join(", ");
        setP(normalized);
        setFileSharing(fs);
        setBaselineJson(snapshot(normalized, fs));
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const tryClose = useCallback(() => {
    if (pendingClose) {
      setPendingClose(false);
      return;
    }
    if (!p || baselineJson === null) {
      onClose();
      return;
    }
    if (snapshot(p, fileSharing) !== baselineJson) setPendingClose(true);
    else onClose();
  }, [p, fileSharing, baselineJson, onClose, pendingClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: WindowEventMap["keydown"]) => {
      if (ev.key === "Escape") {
        if (pendingClose) setPendingClose(false);
        else tryClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pendingClose, tryClose]);

  const discardChanges = () => {
    if (!baselineJson) return;
    try {
      const { p: bp, fileSharing: bfs } = JSON.parse(baselineJson) as {
        p: BusinessProfile;
        fileSharing: string;
      };
      setP(bp);
      setFileSharing(bfs);
    } catch {
      /* ignore */
    }
    setPendingClose(false);
    onClose();
  };

  const save = async (): Promise<boolean> => {
    if (!p) return false;
    const tags = fileSharing
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        user_name: p.user_name,
        business_name: p.business_name,
        business_type: p.business_type,
        country: p.country,
        email_platform: p.email_platform,
        it_support: p.it_support,
        has_cyber_insurance: p.has_cyber_insurance,
        policy_inclusions: p.policy_inclusions,
        policy_exclusions: p.policy_exclusions,
        has_mfa_for_all_users: p.has_mfa_for_all_users,
        sends_sensitive_files_via_email_regularly:
          p.sends_sensitive_files_via_email_regularly,
        uses_file_sharing_solutions: tags,
      };
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const msg =
          typeof d === "object" && d && "detail" in d
            ? String((d as { detail: unknown }).detail)
            : res.statusText;
        throw new Error(msg);
      }
      const next = (await res.json()) as BusinessProfile;
      const merged: BusinessProfile = {
        ...next,
        policy_exclusions: next.policy_exclusions ?? "",
        insurance_declarations_original_name:
          next.insurance_declarations_original_name ?? "",
        insurance_declarations_relpath:
          next.insurance_declarations_relpath ?? "",
        it_support: normalizeItSupport(next.it_support ?? ""),
      };
      setP(merged);
      setBaselineJson(
        snapshot(merged, (merged.uses_file_sharing_solutions ?? []).join(", ")),
      );
      onSaved();
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const uploadInsuranceFile = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    setInsuranceUploadBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/insurance-declarations", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const msg =
          typeof d === "object" && d && "detail" in d
            ? String((d as { detail: unknown }).detail)
            : res.statusText;
        throw new Error(msg);
      }
      const next = (await res.json()) as BusinessProfile;
      const merged: BusinessProfile = {
        ...next,
        policy_exclusions: next.policy_exclusions ?? "",
        insurance_declarations_original_name:
          next.insurance_declarations_original_name ?? "",
        insurance_declarations_relpath:
          next.insurance_declarations_relpath ?? "",
        it_support: normalizeItSupport(next.it_support ?? ""),
      };
      setP(merged);
      setBaselineJson(snapshot(merged, fileSharing));
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setInsuranceUploadBusy(false);
    }
  };

  const removeInsuranceDocument = async () => {
    if (
      !window.confirm(
        "Remove the uploaded declarations file and clear the extracted policy text?",
      )
    ) {
      return;
    }
    setInsuranceUploadBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/insurance-declarations", {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const msg =
          typeof d === "object" && d && "detail" in d
            ? String((d as { detail: unknown }).detail)
            : res.statusText;
        throw new Error(msg);
      }
      const next = (await res.json()) as BusinessProfile;
      const merged: BusinessProfile = {
        ...next,
        policy_exclusions: next.policy_exclusions ?? "",
        insurance_declarations_original_name:
          next.insurance_declarations_original_name ?? "",
        insurance_declarations_relpath:
          next.insurance_declarations_relpath ?? "",
        it_support: normalizeItSupport(next.it_support ?? ""),
      };
      setP(merged);
      setBaselineJson(snapshot(merged, fileSharing));
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setInsuranceUploadBusy(false);
    }
  };

  const reset = async () => {
    if (
      !window.confirm(
        "Reset all memory? This deletes your business profile and all conversation history. This cannot be undone.",
      )
    ) {
      return;
    }
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const msg =
          typeof d === "object" && d && "detail" in d
            ? String((d as { detail: unknown }).detail)
            : res.statusText;
        throw new Error(msg);
      }
      onResetComplete();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) tryClose();
      }}
    >
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="profile-title">Business profile</h2>
          <button
            type="button"
            className="btn ghost icon"
            onClick={tryClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {loading && <p className="modal-muted">Loading…</p>}
        {error && <p className="modal-error">{error}</p>}
        {p && !loading && (
          <>
            <div className="profile-grid">
              <label>
                <span>Your name</span>
                <input
                  className="input"
                  value={p.user_name}
                  onChange={(e) =>
                    setP({ ...p, user_name: e.target.value })
                  }
                />
              </label>
              <label>
                <span>Business name</span>
                <input
                  className="input"
                  value={p.business_name}
                  onChange={(e) =>
                    setP({ ...p, business_name: e.target.value })
                  }
                />
              </label>
              <label>
                <span>Business type</span>
                <input
                  className="input"
                  value={p.business_type}
                  onChange={(e) =>
                    setP({ ...p, business_type: e.target.value })
                  }
                />
              </label>
              <label>
                <span>Country</span>
                <input
                  className="input"
                  value={p.country}
                  onChange={(e) =>
                    setP({ ...p, country: e.target.value })
                  }
                />
              </label>
              <label>
                <span>Email platform</span>
                <select
                  className="input"
                  value={p.email_platform}
                  onChange={(e) =>
                    setP({ ...p, email_platform: e.target.value })
                  }
                >
                  <option value="">—</option>
                  <option value="gsuite">Google Workspace (GSuite)</option>
                  <option value="m365">Microsoft 365</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                <span>IT support</span>
                <select
                  className="input"
                  value={p.it_support}
                  onChange={(e) =>
                    setP({ ...p, it_support: e.target.value })
                  }
                >
                  <option value="">—</option>
                  <option value="in_house">In-house</option>
                  <option value="outsourced">Outsourced</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label>
                <span>Cyber insurance</span>
                <select
                  className="input"
                  value={boolToTri(p.has_cyber_insurance)}
                  onChange={(e) =>
                    setP({
                      ...p,
                      has_cyber_insurance: triToBool(e.target.value),
                    })
                  }
                >
                  <option value="">Not set</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              {p.has_cyber_insurance === true && (
                <div className="full insurance-declarations-block">
                  <span className="insurance-block-title">
                    Declarations page (PDF or TXT)
                  </span>
                  <p className="modal-muted insurance-upload-hint">
                    Upload your policy declarations page. We extract coverage and
                    exclusions for incident support—you can edit the text below.
                  </p>
                  {(p.insurance_declarations_relpath || "").trim() !== "" ? (
                    <div className="insurance-file-row">
                      <span className="insurance-file-name" title="Uploaded file">
                        {p.insurance_declarations_original_name ||
                          "Declarations file"}
                      </span>
                      <a
                        className="btn ghost"
                        href="/api/profile/insurance-declarations/file"
                        download
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        className="btn ghost danger-text"
                        disabled={insuranceUploadBusy}
                        onClick={() => void removeInsuranceDocument()}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="insurance-file-row">
                      <input
                        ref={insuranceFileInputRef}
                        type="file"
                        accept=".pdf,.txt,application/pdf,text/plain"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void uploadInsuranceFile(f);
                        }}
                      />
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={insuranceUploadBusy}
                        onClick={() =>
                          insuranceFileInputRef.current?.click()
                        }
                      >
                        {insuranceUploadBusy ? "Uploading…" : "Choose file…"}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <label
                className={`full${p.has_cyber_insurance === false ? " field-disabled" : ""}`}
              >
                <span>Policy inclusions (coverage)</span>
                {p.has_cyber_insurance === false && (
                  <span className="field-disabled-hint">
                    — only if you have cyber insurance
                  </span>
                )}
                <textarea
                  className="input mono"
                  rows={4}
                  value={p.policy_inclusions}
                  disabled={p.has_cyber_insurance === false}
                  onChange={(e) =>
                    setP({ ...p, policy_inclusions: e.target.value })
                  }
                />
              </label>
              <label
                className={`full${p.has_cyber_insurance === false ? " field-disabled" : ""}`}
              >
                <span>Policy exclusions</span>
                {p.has_cyber_insurance === false && (
                  <span className="field-disabled-hint">
                    — only if you have cyber insurance
                  </span>
                )}
                <textarea
                  className="input mono"
                  rows={3}
                  value={p.policy_exclusions}
                  disabled={p.has_cyber_insurance === false}
                  onChange={(e) =>
                    setP({ ...p, policy_exclusions: e.target.value })
                  }
                />
              </label>
              <label>
                <span>MFA Enabled</span>
                <select
                  className="input"
                  value={boolToTri(p.has_mfa_for_all_users)}
                  onChange={(e) =>
                    setP({
                      ...p,
                      has_mfa_for_all_users: triToBool(e.target.value),
                    })
                  }
                >
                  <option value="">Not set</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label>
                <span>Sends sensitive files by email often</span>
                <select
                  className="input"
                  value={boolToTri(p.sends_sensitive_files_via_email_regularly)}
                  onChange={(e) =>
                    setP({
                      ...p,
                      sends_sensitive_files_via_email_regularly: triToBool(
                        e.target.value,
                      ),
                    })
                  }
                >
                  <option value="">Not set</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label className="full">
                <span>File sharing (comma-separated, e.g. drive, sharepoint)</span>
                <input
                  className="input"
                  value={fileSharing}
                  onChange={(e) => setFileSharing(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => void save()}
                disabled={saving || resetting}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
            <div className="modal-danger-zone">
              <p className="danger-label">Danger zone</p>
              <button
                type="button"
                className="btn danger"
                onClick={() => void reset()}
                disabled={saving || resetting}
              >
                {resetting ? "Resetting…" : "Reset all memory"}
              </button>
            </div>
            {pendingClose && (
              <div
                className="modal-nested-confirm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="unsaved-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-nested-confirm-card">
                  <p id="unsaved-title" className="modal-nested-confirm-title">
                    Unsaved changes
                  </p>
                  <p className="modal-muted">
                    Save your changes before closing, or discard them.
                  </p>
                  <div className="modal-confirm-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={saving}
                      onClick={() =>
                        void save().then((ok) => {
                          if (ok) {
                            setPendingClose(false);
                            onClose();
                          }
                        })
                      }
                    >
                      Save &amp; close
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={discardChanges}
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setPendingClose(false)}
                    >
                      Keep editing
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ProfileModal;
