"use client";

import { useActionState, useRef, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { TelegramStatus } from "@/lib/admin/telegram";
import styles from "./sales-refresh.module.css";
import type { SalesAction } from "./types";

/**
 * Telegram bot settings: write-only secret fields, an explicit test send,
 * and a confirmed removal. The saved token is never displayed back — the
 * fields always start empty and saving replaces the whole configuration.
 * Rendered only for staff in the settings area (owner); the Server Actions
 * re-check that permission themselves.
 */
export function TelegramSettingsForm({
  status,
  saveAction,
  testAction,
  deleteAction,
}: {
  status: TelegramStatus | null;
  saveAction: SalesAction;
  testAction: SalesAction;
  deleteAction: SalesAction;
}) {
  const [saveState, saveFormAction] = useActionState(saveAction, null);
  const [testState, testFormAction] = useActionState(testAction, null);
  const [deleteState, deleteFormAction] = useActionState(deleteAction, null);
  const [showToken, setShowToken] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // When the status is known, a test send is blocked with a reason instead
  // of failing; when the status could not be loaded, the attempt runs and
  // the action reports honestly.
  const testBlocked =
    status !== null && (!status.configured || !status.enabled);
  const testBlockReason =
    status !== null && !status.configured
      ? "Save the bot token and chat ID first, then send a test message."
      : "Telegram alerts are disabled. Enable them above, save, then send a test message.";

  return (
    <div>
      <form action={saveFormAction} method="post">
        <div className={styles.formGrid}>
          <div className="aa-field">
            <label htmlFor="telegram-token">Bot token</label>
            <input
              id="telegram-token"
              name="bot_token"
              type={showToken ? "text" : "password"}
              required
              maxLength={200}
              placeholder="123456789:ABC…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="aa-hint">
              From BotFather. Stored as a secret and never shown again — leave
              nothing here unless you are replacing it.
            </p>
            <span className="aa-check-row">
              <label>
                <input
                  type="checkbox"
                  checked={showToken}
                  onChange={(event) => setShowToken(event.target.checked)}
                />
                Show bot token
              </label>
            </span>
          </div>
          <div className="aa-field">
            <label htmlFor="telegram-chat">Chat ID</label>
            <input
              id="telegram-chat"
              name="chat_id"
              type="text"
              inputMode="numeric"
              required
              maxLength={20}
              placeholder="123456789…"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="aa-hint">
              The numeric ID of the chat the bot messages. Group chats use a
              negative ID. The bot must have messaged this chat before it can
              deliver.
            </p>
          </div>
          <div className="aa-field">
            <span className="aa-check-row">
              <label>
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={status?.enabled ?? true}
                />
                Send Telegram alerts
              </label>
            </span>
            <p className="aa-hint">
              When off, no Telegram message is sent, including test messages.
            </p>
          </div>
        </div>
        <FormMessage state={saveState} />
        <div className="aa-form-actions">
          <SubmitButton pendingLabel="Saving…">Save Telegram settings</SubmitButton>
        </div>
      </form>

      <form action={testFormAction} method="post">
        <p className={styles.sectionNote}>
          Send one test message to the saved chat to confirm the bot can
          deliver. Nothing else is sent from this panel.
        </p>
        <FormMessage state={testBlocked ? null : testState} />
        {testBlocked ? (
          <p role="status" className="aa-notice aa-notice--info">
            {testBlockReason}
          </p>
        ) : null}
        <div className="aa-form-actions">
          {testBlocked ? (
            <button type="button" className="aa-secondary" disabled>
              Send test message
            </button>
          ) : (
            <SubmitButton pendingLabel="Sending…" className="aa-secondary">
              Send test message
            </SubmitButton>
          )}
        </div>
      </form>

      {status?.configured ? (
        <div className={styles.dangerZone}>
          <p className={styles.sectionNote}>
            Removing the settings deletes the saved bot token and chat ID. No
            Telegram messages will be sent afterwards.
          </p>
          <div className={styles.actionRow}>
            <button
              type="button"
              className={`${styles.dangerButton} aa-button`}
              data-danger
              onClick={() => {
                setDialogOpen(true);
                dialog.current?.showModal();
              }}
            >
              Remove Telegram settings
            </button>
          </div>
          <dialog
            ref={dialog}
            className="aa-dialog"
            onClose={() => setDialogOpen(false)}
            aria-label="Remove Telegram settings"
          >
            {dialogOpen ? (
              <form action={deleteFormAction} method="post">
                <h2>Remove Telegram settings?</h2>
                <p>
                  The saved bot token and chat ID will be deleted. You will
                  need to enter them again to reconnect Telegram.
                </p>
                <FormMessage state={deleteState} />
                <div className="aa-dialog-actions">
                  <button
                    type="button"
                    className="aa-secondary"
                    onClick={() => dialog.current?.close()}
                  >
                    Cancel
                  </button>
                  <SubmitButton pendingLabel="Removing…" danger>
                    Remove settings
                  </SubmitButton>
                </div>
              </form>
            ) : null}
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
