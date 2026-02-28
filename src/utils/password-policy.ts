export const MIN_PASSWORD_LENGTH = 8;

export function isPasswordValid(password: string): boolean {
    return password.length >= MIN_PASSWORD_LENGTH;
}

export function getPasswordPolicyErrorMessage(): string {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
}
