export type AuthFormState = { error?: string; message?: string };

export function readCredentials(formData: FormData, registering: boolean) {
  const email = formData.get('email');
  const password = formData.get('password');

  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    password.length === 0 ||
    password.length > 128 ||
    (registering && password.length < 8)
  ) {
    return null;
  }

  return { email: email.trim().toLowerCase(), password };
}
