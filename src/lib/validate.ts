import { z } from 'zod';
import { badRequest } from './errors.ts';

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const message = issue?.message && !issue.message.startsWith('Invalid') ? issue.message : 'Die Eingabe ist ungültig';
  throw badRequest(message);
}

export const id = z.string().regex(/^[0-9A-Za-z]{8,40}$/, 'Ungültige Kennung');

export const ids = z.array(id).min(1, 'Wähle mindestens ein Element aus').max(1000, 'Höchstens 1000 Elemente auf einmal');

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Die Farbe muss als Hex-Wert wie #8b5cf6 angegeben werden');

export const username = z
  .string()
  .trim()
  .min(3, 'Der Benutzername braucht mindestens 3 Zeichen')
  .max(32, 'Der Benutzername darf höchstens 32 Zeichen haben')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Der Benutzername darf nur Buchstaben, Ziffern, Punkt, Minus und Unterstrich enthalten');

export const displayName = z.string().trim().min(1, 'Gib einen Namen ein').max(80, 'Der Name darf höchstens 80 Zeichen haben');

export const email = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Die E-Mail-Adresse sieht nicht richtig aus');

export const password = z.string().min(10, 'Das Passwort braucht mindestens 10 Zeichen').max(512, 'Das Passwort ist zu lang');

export const bool = z.union([z.boolean(), z.literal('on'), z.literal('true'), z.literal('1')]).transform((value) => value !== false);

const tokens = z
  .record(z.string().regex(/^[a-zA-Z]{2,40}$/), z.string().regex(/^#[0-9a-fA-F]{6}$/))
  .refine(
    (value) => ['primary', 'onPrimary', 'surface', 'onSurface', 'surfaceContainerLow', 'outline'].every((key) => key in value),
    'Die Farbpalette ist unvollständig'
  );

export const palette = z.object({ dark: tokens, light: tokens });

export const quota = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
