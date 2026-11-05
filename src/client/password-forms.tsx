import { useEffect, useRef } from 'react';
import type { z } from 'zod';
import type { apiSchemas } from '../contracts/index.ts';
import { Button, Input } from './design/components.tsx';

function PasswordField({ creating = false }: { creating?: boolean }) {
  return (
    <>
      <label htmlFor="account-password">{creating ? 'New password' : 'Password'}</label>
      <Input
        id="account-password"
        name="password"
        type="password"
        required
        minLength={creating ? 15 : 1}
        maxLength={128}
        autoComplete={creating ? 'new-password' : 'current-password'}
        aria-describedby={creating ? 'password-length' : undefined}
      />
      {creating && (
        <p className="field-hint" id="password-length">
          Use 15 to 128 characters. A few words work well.
        </p>
      )}
    </>
  );
}

export function PasswordLoginForm({
  busy,
  onLogin,
}: {
  busy: boolean;
  onLogin: (input: z.infer<typeof apiSchemas.PasswordLogin>) => void;
}) {
  return (
    <form
      method="post"
      className="password-form"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        onLogin({
          identifier: String(fields.get('identifier')),
          password: String(fields.get('password')),
        });
      }}
    >
      <fieldset disabled={busy}>
        <label htmlFor="login-identifier">Username or email</label>
        <Input
          id="login-identifier"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
        />
        <PasswordField />
        <Button type="submit">Sign in</Button>
      </fieldset>
    </form>
  );
}

export function PasswordSetupForm({
  busy,
  submitLabel,
  onSubmit,
}: {
  busy: boolean;
  submitLabel: string;
  onSubmit: (input: z.infer<typeof apiSchemas.PasswordRegistration>) => void;
}) {
  return (
    <form
      method="post"
      className="password-form"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        onSubmit({
          username: String(fields.get('username')),
          email: String(fields.get('email')),
          password: String(fields.get('password')),
        });
      }}
    >
      <fieldset disabled={busy}>
        <label htmlFor="new-username">Username</label>
        <Input
          id="new-username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={32}
          pattern={'[A-Za-z0-9_\\-]+'}
          aria-describedby="username-format"
        />
        <p className="field-hint" id="username-format">
          Use 3 to 32 letters, numbers, underscores or hyphens.
        </p>
        <label htmlFor="new-email">Email</label>
        <Input
          id="new-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
        />
        <PasswordField creating />
        <Button type="submit">{submitLabel}</Button>
      </fieldset>
    </form>
  );
}

export function PasswordOnlyForm({
  busy,
  creating = false,
  onSubmit,
}: {
  busy: boolean;
  creating?: boolean;
  onSubmit: (password: string) => void;
}) {
  return (
    <form
      method="post"
      className="password-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(String(new FormData(event.currentTarget).get('password')));
      }}
    >
      <fieldset disabled={busy}>
        <PasswordField creating={creating} />
        <Button type="submit">{creating ? 'Set new password' : 'Confirm password'}</Button>
      </fieldset>
    </form>
  );
}

export type ConfirmationAnswer = { password: string } | 'passkey' | null;
export function PasswordDialog({
  allowPasskey,
  onAnswer,
}: {
  allowPasskey: boolean;
  onAnswer: (answer: ConfirmationAnswer) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      className="card password-dialog"
      ref={ref}
      aria-labelledby="confirm-password-title"
      onCancel={(event) => {
        event.preventDefault();
        onAnswer(null);
      }}
    >
      <h2 id="confirm-password-title">Confirm your password</h2>
      <PasswordOnlyForm busy={false} onSubmit={(password) => onAnswer({ password })} />
      {allowPasskey && (
        <Button variant="secondary" onClick={() => onAnswer('passkey')}>
          Use a passkey instead
        </Button>
      )}
      <Button variant="text-button" onClick={() => onAnswer(null)}>
        Cancel
      </Button>
    </dialog>
  );
}
