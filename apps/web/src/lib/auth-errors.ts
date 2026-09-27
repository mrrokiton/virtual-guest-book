const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Nieprawidłowy e-mail lub hasło.',
  EMAIL_NOT_VERIFIED: 'Najpierw potwierdź adres e-mail. Wysłaliśmy ponownie link aktywacyjny.',
  USER_ALREADY_EXISTS: 'Konto z tym adresem już istnieje. Zaloguj się.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Konto z tym adresem już istnieje. Zaloguj się.',
  PASSWORD_TOO_SHORT: 'Hasło musi mieć co najmniej 10 znaków.',
  PASSWORD_TOO_LONG: 'Hasło jest zbyt długie.',
  INVALID_TOKEN: 'Link wygasł lub jest nieprawidłowy. Poproś o nowy.',
  INVALID_EMAIL: 'Nieprawidłowy adres e-mail.',
};

export function authErrorMessage(
  error: { code?: string; message?: string; status?: number } | null | undefined,
): string {
  if (!error) return 'Coś poszło nie tak. Spróbuj ponownie.';
  if (error.status === 429) return 'Zbyt wiele prób. Odczekaj chwilę.';
  return (error.code && MESSAGES[error.code]) || 'Coś poszło nie tak. Spróbuj ponownie.';
}
