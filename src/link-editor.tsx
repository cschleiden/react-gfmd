import { Popover } from "@base-ui/react/popover";
import { Link2, Link2Off } from "lucide-react";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import {
  applyLinkEdit,
  linkSelection,
  openLink,
  removeLink,
  restoreLinkSelection,
  type LinkSelection,
} from "./link";
import { dispatchIsolatedTransaction } from "./history";

interface LinkEditorProps {
  state: EditorState;
  view: EditorView;
  contextualOwnerId?: string;
  onOpenChange?: (open: boolean) => void;
  resetKey?: number;
}

interface LinkDraft {
  target: LinkSelection;
  sourceDoc: ProseMirrorNode;
  href: string;
  title: string;
  label: string | null;
  error: string;
}

export function LinkEditor({
  contextualOwnerId,
  onOpenChange,
  resetKey,
  state,
  view,
}: LinkEditorProps) {
  const [draft, setDraft] = React.useState<LinkDraft | null>(null);
  const urlInputRef = React.useRef<HTMLInputElement>(null);
  const previousResetKey = React.useRef(resetKey);
  const currentTarget = linkSelection(state);
  const active = currentTarget?.kind !== "new" && currentTarget !== null;

  React.useEffect(() => {
    if (draft && draft.sourceDoc !== state.doc) {
      setDraft(null);
      onOpenChange?.(false);
    }
  }, [draft, onOpenChange, state.doc]);

  React.useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    if (!draft) return;
    setDraft(null);
    onOpenChange?.(false);
  }, [draft, onOpenChange, resetKey]);

  function updateDraft(update: Partial<LinkDraft>) {
    setDraft((current) => current ? { ...current, ...update } : current);
  }

  function close(restoreSelection: boolean) {
    if (restoreSelection && draft) {
      restoreLinkSelection(view, draft.target);
    } else {
      view.focus();
    }
    setDraft(null);
    onOpenChange?.(false);
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      close(true);
      return;
    }

    const target = linkSelection(view.state);
    if (!target) return;
    onOpenChange?.(true);
    setDraft({
      target,
      sourceDoc: view.state.doc,
      href: target.href,
      title: target.title,
      label: target.label,
      error: "",
    });
  }

  function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.href.trim()) {
      updateDraft({ error: "Enter a link URL." });
      return;
    }

    dispatchIsolatedTransaction(
      view,
      applyLinkEdit(view.state, draft.target, draft).scrollIntoView(),
      { focus: false },
    );
    close(false);
  }

  function unlink() {
    if (!draft || draft.target.kind === "new") return;
    dispatchIsolatedTransaction(
      view,
      removeLink(view.state, draft.target).scrollIntoView(),
      { focus: false },
    );
    close(false);
  }

  function openCurrentLink() {
    if (draft && !openLink(draft.href)) {
      updateDraft({ error: "This URL cannot be opened safely." });
    }
  }

  return (
    <Popover.Root
      modal="trap-focus"
      onOpenChange={handleOpenChange}
      open={draft !== null}
    >
      <Popover.Trigger
        aria-label={active ? "Edit link" : "Add link"}
        aria-pressed={active}
        className="gfmd-toolbar-button"
        data-active={active ? "" : undefined}
        disabled={!currentTarget}
        onMouseDown={(event) => event.preventDefault()}
        title={active ? "Edit link" : "Add link"}
        type="button"
      >
        <Link2 className="gfmd-toolbar-icon" size={16} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="start" sideOffset={4}>
          <Popover.Popup
            className="gfmd-link-popover"
            data-gfmd-contextual-owner={contextualOwnerId}
            finalFocus={false}
            initialFocus={urlInputRef}
          >
            <Popover.Title className="gfmd-link-popover-title">
              {draft?.target.kind === "new" ? "Add link" : "Edit link"}
            </Popover.Title>
            {draft ? (
              <form className="gfmd-link-form" onSubmit={apply}>
                <label className="gfmd-link-field">
                  <span>Text</span>
                  <input
                    aria-describedby={
                      draft.label === null ? "gfmd-link-content-help" : undefined
                    }
                    aria-label="Link text"
                    disabled={draft.label === null}
                    onChange={(event) =>
                      updateDraft({ label: event.target.value })
                    }
                    value={draft.label ?? "Non-text link content"}
                  />
                </label>
                {draft.label === null ? (
                  <p className="gfmd-link-help" id="gfmd-link-content-help">
                    The linked content can be preserved, but edited in the
                    document rather than this field.
                  </p>
                ) : null}
                <label className="gfmd-link-field">
                  <span>URL</span>
                  <input
                    aria-describedby={
                      draft.error ? "gfmd-link-error" : undefined
                    }
                    aria-invalid={draft.error ? true : undefined}
                    aria-label="Link URL"
                    onChange={(event) =>
                      updateDraft({ href: event.target.value, error: "" })
                    }
                    ref={urlInputRef}
                    required
                    value={draft.href}
                  />
                </label>
                <label className="gfmd-link-field">
                  <span>Title (optional)</span>
                  <input
                    aria-label="Link title"
                    onChange={(event) =>
                      updateDraft({ title: event.target.value })
                    }
                    value={draft.title}
                  />
                </label>
                {draft.error ? (
                  <p
                    className="gfmd-link-error"
                    id="gfmd-link-error"
                    role="alert"
                  >
                    {draft.error}
                  </p>
                ) : null}
                <div className="gfmd-link-actions">
                  {draft.target.kind !== "new" ? (
                    <>
                      <button
                        className="gfmd-link-button gfmd-link-button-secondary"
                        onClick={openCurrentLink}
                        type="button"
                      >
                        Open link
                      </button>
                      <button
                        aria-label="Remove link"
                        className="gfmd-link-button gfmd-link-button-danger"
                        onClick={unlink}
                        type="button"
                      >
                        <Link2Off size={14} />
                        Unlink
                      </button>
                    </>
                  ) : null}
                  <span className="gfmd-link-actions-spacer" />
                  <Popover.Close
                    className="gfmd-link-button gfmd-link-button-secondary"
                    type="button"
                  >
                    Cancel
                  </Popover.Close>
                  <button
                    className="gfmd-link-button gfmd-link-button-primary"
                    type="submit"
                  >
                    Apply
                  </button>
                </div>
              </form>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
