"use client";

import { Eye, EyeOff, Lock, Mail, Phone, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { DemoNotice } from "@/components/ui/DemoNotice";
import { Checkbox, Input } from "@/components/ui/Field";
import { isValidBdPhone, isValidEmail, type FieldErrors } from "@/lib/validation";
import { setNewCustomerPassword } from "@/lib/customer/actions";
import { registerAction, requestPasswordResetAction, signInAction } from "@/services/actions";
import { GoogleSignInButton } from "./GoogleSignInButton";

function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return <DemoNotice force>{message}</DemoNotice>;
}

/** Move keyboard and screen-reader focus to the first invalid field after a failed submit. */
function focusFirstError(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} spellCheck={false} autoCapitalize="off" leftIcon={<Lock className="h-4 w-4" aria-hidden />} className="pr-11" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-0 top-[22px] flex h-11 w-11 items-center justify-center rounded text-ink-muted hover:text-ink" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
        {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

function OAuthDivider() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      <span className="text-xs text-ink-muted">or continue with email</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Sign-in is email-only: phone-shaped input is rejected with a clear message, never resolved. */
function emailFieldError(value: string, action: "sign in" | "reset your password"): string | undefined {
  if (isValidEmail(value)) return undefined;
  if (isValidBdPhone(value)) {
    const mobileClause = action === "sign in" ? "Mobile sign-in is not available." : "Mobile password reset is not available.";
    return `Use your email address to ${action}. ${mobileClause}`;
  }
  return "Enter a valid email address";
}

export function LoginForm({ next, onSignedIn }: { next?: string; onSignedIn?: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<"email" | "password">>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <GoogleSignInButton next={next} />
      <OAuthDivider />
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const errs: typeof errors = {};
          const emailError = emailFieldError(email, "sign in");
          if (emailError) errs.email = emailError;
          if (password.length === 0) errs.password = "Enter your password";
          setErrors(errs);
          if (errs.email) return focusFirstError("login-email");
          if (errs.password) return focusFirstError("login-password");
          start(async () => {
            try {
              const r = await signInAction({ email, password });
              if (r.ok) {
                // Inside the review modal, stay on the product page:
                // the caller switches to the review form. Everywhere
                // else the default navigation is unchanged.
                if (onSignedIn) onSignedIn();
                else {
                  router.push(next ?? "/account");
                  router.refresh();
                }
              } else {
                setMessage(r.message);
              }
            } catch {
              setMessage("The request could not be completed. Please try again.");
            }
          });
        }}
      >
        <Input id="login-email" name="username" label="Email" type="email" leftIcon={<Mail className="h-4 w-4" aria-hidden />} autoComplete="username" spellCheck={false} placeholder="you@example.com…" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <PasswordInput id="login-password" name="current-password" label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <div className="flex items-center justify-end">
          <Link href="/account/forgot-password" className="text-xs text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Notice message={message} />
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Sign In
        </Button>
      </form>
    </div>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", confirm: "" });
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<keyof typeof form | "agree">>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <GoogleSignInButton next={next} />
      <OAuthDivider />
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const errs: typeof errors = {};
          if (form.fullName.trim().length < 3) errs.fullName = "Enter your full name";
          if (!isValidEmail(form.email)) errs.email = "Enter a valid email";
          if (!isValidBdPhone(form.phone)) errs.phone = "Enter a valid mobile number (01XXXXXXXXX)";
          if (form.password.length < 8) errs.password = "Use at least 8 characters";
          if (form.confirm !== form.password) errs.confirm = "Passwords do not match";
          if (!agree) errs.agree = "Please accept the terms";
          setErrors(errs);
          if (errs.fullName) return focusFirstError("register-fullName");
          if (errs.email) return focusFirstError("register-email");
          if (errs.phone) return focusFirstError("register-phone");
          if (errs.password) return focusFirstError("register-password");
          if (errs.confirm) return focusFirstError("register-confirm");
          if (errs.agree) return focusFirstError("register-agree");
          start(async () => {
            try {
              const r = await registerAction({ fullName: form.fullName, email: form.email, phone: form.phone, password: form.password });
              if (r.ok && r.data.signedIn) {
                router.push(next ?? "/account");
                router.refresh();
              } else if (r.ok) {
                setMessage("Check your email to confirm your account, then sign in.");
              } else {
                setMessage(r.message);
              }
            } catch {
              setMessage("The request could not be completed. Please try again.");
            }
          });
        }}
      >
        <Input id="register-fullName" name="name" label="Full Name" leftIcon={<User className="h-4 w-4" aria-hidden />} autoComplete="name" value={form.fullName} onChange={set("fullName")} error={errors.fullName} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input id="register-email" name="email" label="Email" type="email" leftIcon={<Mail className="h-4 w-4" aria-hidden />} autoComplete="email" spellCheck={false} value={form.email} onChange={set("email")} error={errors.email} />
          <Input id="register-phone" name="tel" label="Mobile Number" type="tel" leftIcon={<Phone className="h-4 w-4" aria-hidden />} autoComplete="tel" placeholder="01XXXXXXXXX" value={form.phone} onChange={set("phone")} error={errors.phone} />
        </div>
        <PasswordInput id="register-password" name="new-password" label="Password" autoComplete="new-password" value={form.password} onChange={set("password")} error={errors.password} hint="At least 8 characters" />
        <PasswordInput id="register-confirm" name="new-password" label="Confirm Password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} error={errors.confirm} />
        <div>
          <Checkbox
            id="register-agree"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            label={
              <>
                I agree to the{" "}
                <Link href="/terms" className="text-primary underline">
                  Terms
                </Link>{" "}
                and{" "}
                <Link href="/privacy-policy" className="text-primary underline">
                  Privacy Policy
                </Link>
              </>
            }
          />
          {errors.agree && <p className="mt-1 text-xs text-danger" role="alert">{errors.agree}</p>}
        </div>
        <Notice message={message} />
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Create Account
        </Button>
      </form>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const emailError = emailFieldError(email, "reset your password");
        if (emailError) {
          setError(emailError);
          return focusFirstError("forgot-email");
        }
        setError(undefined);
        start(async () => {
          try {
            const r = await requestPasswordResetAction({ email });
            // Generic either way: never reveal whether the account exists.
            setMessage(r.ok ? "If an account exists for this email, you will receive a password reset link." : r.message);
          } catch {
            setMessage("The request could not be completed. Please try again.");
          }
        });
      }}
    >
      <Input id="forgot-email" name="username" label="Email" type="email" leftIcon={<Mail className="h-4 w-4" aria-hidden />} autoComplete="username" spellCheck={false} placeholder="you@example.com…" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
      <Notice message={message} />
      <Button type="submit" size="lg" fullWidth loading={pending}>
        Send Reset Link
      </Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors<"password" | "confirm">>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const errs: typeof errors = {};
        if (password.length < 8) errs.password = "Use at least 8 characters";
        if (confirm !== password) errs.confirm = "Passwords do not match";
        setErrors(errs);
        if (errs.password) return focusFirstError("reset-password");
        if (errs.confirm) return focusFirstError("reset-confirm");
        start(async () => {
          try {
            const r = await setNewCustomerPassword({ password });
            if (r.ok) {
              router.push("/account");
              router.refresh();
            } else {
              setMessage(r.message);
            }
          } catch {
            setMessage("The request could not be completed. Please try again.");
          }
        });
      }}
    >
      <PasswordInput id="reset-password" name="new-password" label="New Password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="At least 8 characters" />
      <PasswordInput id="reset-confirm" name="new-password" label="Confirm New Password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
      <Notice message={message} />
      <Button type="submit" size="lg" fullWidth loading={pending}>
        Set New Password
      </Button>
    </form>
  );
}
