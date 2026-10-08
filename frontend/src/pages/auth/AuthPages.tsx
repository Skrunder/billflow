import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import * as account from '../../data/account';
import { useServerConfig } from '../../api/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorNotice, Field } from '../../components/ui/misc';
import { Spinner } from '../../components/ui/Spinner';

function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/icons/icon-192.png" alt="" className="mb-3 h-14 w-14 rounded-2xl shadow-sm" />
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        <div className="card p-6">{children}</div>
        {footer && <div className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">{footer}</div>}
      </div>
    </div>
  );
}

function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="btn-primary w-full" disabled={busy}>
      {busy && <Spinner className="h-4 w-4 text-white" />}
      {children}
    </button>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: config } = useServerConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (config?.needsSetup) navigate('/register', { replace: true });
  }, [config, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(new Error(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to BillFlow"
      footer={config?.registrationOpen && <>No account? <Link to="/register" className="font-medium text-brand-600 hover:underline">Create one</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorNotice error={error} />
        <Field label="Email">
          {(id) => <input id={id} type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}
        </Field>
        <Field label="Password">
          {(id) => <input id={id} type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <SubmitButton busy={busy}>Sign in</SubmitButton>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-brand-600 hover:underline">Forgot password?</Link>
        </p>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { data: config } = useServerConfig();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  if (config && !config.registrationOpen) {
    return (
      <AuthCard title="Registration closed" footer={<Link to="/login" className="text-brand-600 hover:underline">Back to sign in</Link>}>
        <p className="text-sm text-slate-600 dark:text-slate-300">New accounts are disabled on this server. Ask your administrator for access.</p>
      </AuthCard>
    );
  }
  if (checkEmail) {
    return (
      <AuthCard title="Check your email" footer={<Link to="/login" className="text-brand-600 hover:underline">Back to sign in</Link>}>
        <p className="text-sm text-slate-600 dark:text-slate-300">We sent a verification link to <strong>{email}</strong>. Open it to activate your account.</p>
      </AuthCard>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(new Error('Passwords do not match'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await register({ email, password, displayName });
      if (res.verificationRequired) setCheckEmail(true);
      else navigate('/', { replace: true });
    } catch (err) {
      setError(new Error(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title={config?.needsSetup ? 'Set up your server' : 'Create your account'}
      subtitle={config?.needsSetup ? 'This first account becomes the administrator.' : 'Track bills and events in one place.'}
      footer={!config?.needsSetup && <>Already have an account? <Link to="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorNotice error={error} />
        <Field label="Name">
          {(id) => <input id={id} autoComplete="name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} autoFocus />}
        </Field>
        <Field label="Email">
          {(id) => <input id={id} type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Field label="Password" hint="At least 8 characters">
          {(id) => <input id={id} type="password" autoComplete="new-password" minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <Field label="Confirm password">
          {(id) => <input id={id} type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        <p className="text-xs text-slate-500">Your timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}) is detected automatically — change it any time in Settings.</p>
        <SubmitButton busy={busy}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const { data: config } = useServerConfig();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await account.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(new Error(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Reset password" footer={<Link to="/login" className="text-brand-600 hover:underline">Back to sign in</Link>}>
      {config && !config.passwordResetEnabled ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Email is not configured on this server, so reset links can&apos;t be sent. Ask your administrator to reset your password with the
          command-line tool (see the README).
        </p>
      ) : sent ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires in 1 hour.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <ErrorNotice error={error} />
          <Field label="Email">
            {(id) => <input id={id} type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}
          </Field>
          <SubmitButton busy={busy}>Send reset link</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(new Error('Passwords do not match'));
    setBusy(true);
    setError(null);
    try {
      await account.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(new Error(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Choose a new password" footer={<Link to="/login" className="text-brand-600 hover:underline">Back to sign in</Link>}>
      {done ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">Your password was changed and all other sessions were signed out. You can now sign in.</p>
      ) : !token ? (
        <ErrorNotice error={new Error('This reset link is missing its token.')} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <ErrorNotice error={error} />
          <Field label="New password" hint="At least 8 characters">
            {(id) => <input id={id} type="password" autoComplete="new-password" minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />}
          </Field>
          <Field label="Confirm new password">
            {(id) => <input id={id} type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
          </Field>
          <SubmitButton busy={busy}>Set password</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke: tokens are single use
    ran.current = true;
    if (!token) {
      setState('error');
      setMessage('This verification link is missing its token.');
      return;
    }
    account
      .verifyEmail(token)
      .then(() => setState('ok'))
      .catch((err) => {
        setState('error');
        setMessage(errorMessage(err));
      });
  }, [token]);

  return (
    <AuthCard title="Email verification" footer={<Link to="/login" className="text-brand-600 hover:underline">Go to sign in</Link>}>
      {state === 'working' && (
        <p className="flex items-center gap-2 text-sm">
          <Spinner /> Verifying…
        </p>
      )}
      {state === 'ok' && <p className="text-sm text-slate-600 dark:text-slate-300">Your email is verified. You can sign in now.</p>}
      {state === 'error' && <ErrorNotice error={new Error(message)} />}
    </AuthCard>
  );
}
