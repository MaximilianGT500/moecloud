import type { ReactNode } from 'react';
import AssignmentRounded from '@mui/icons-material/AssignmentRounded';
import BookmarksRounded from '@mui/icons-material/BookmarksRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import CodeRounded from '@mui/icons-material/CodeRounded';
import ContactsRounded from '@mui/icons-material/ContactsRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import HowToVoteRounded from '@mui/icons-material/HowToVoteRounded';
import LibraryMusicRounded from '@mui/icons-material/LibraryMusicRounded';
import MailRounded from '@mui/icons-material/MailRounded';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import RssFeedRounded from '@mui/icons-material/RssFeedRounded';
import SellRounded from '@mui/icons-material/SellRounded';
import StickyNote2Rounded from '@mui/icons-material/StickyNote2Rounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import { FEATURE_PARENT, FEATURES, type Feature } from '../../../../shared/features';
import { t } from '../../lib/i18n';

export type AppGroup = 'media' | 'planning' | 'people' | 'web';

export interface AppInfo {
  key: Feature;
  label: string;
  text: string;
  icon: ReactNode;
  group: AppGroup;
  parent?: Feature;
}

export function appCatalog(): AppInfo[] {
  const info: Record<Feature, Omit<AppInfo, 'key' | 'parent'>> = {
    photos: { label: t('Fotos'), text: t('Zeitleiste, Alben und Erinnerungen an früher'), icon: <PhotoLibraryRounded />, group: 'media' },
    music: { label: t('Musik'), text: t('Bibliothek, Wiedergabelisten und Player'), icon: <LibraryMusicRounded />, group: 'media' },
    notes: {
      label: t('Notizen'),
      text: t('Notizen in Markdown, die in deinen Dateien liegen'),
      icon: <StickyNote2Rounded />,
      group: 'media',
    },
    forms: {
      label: t('Formulare'),
      text: t('Umfragen und Anmeldungen, die andere über einen Link ausfüllen'),
      icon: <AssignmentRounded />,
      group: 'media',
    },
    tags: { label: t('Schlagwörter'), text: t('Dateien mit farbigen Schlagwörtern ordnen'), icon: <SellRounded />, group: 'media' },
    calendar: {
      label: t('Kalender'),
      text: t('Termine und Einladungen, dazu die nächsten Termine auf der Startseite'),
      icon: <CalendarMonthRounded />,
      group: 'planning',
    },
    tasks: {
      label: t('Aufgaben'),
      text: t('Aufgaben mit Fälligkeit, dazu die offenen Aufgaben auf der Startseite'),
      icon: <TaskAltRounded />,
      group: 'planning',
    },
    booking: {
      label: t('Buchungsseiten'),
      text: t('Freie Zeiten, die andere ohne Konto buchen'),
      icon: <EventAvailableRounded />,
      group: 'planning',
    },
    polls: {
      label: t('Terminumfragen'),
      text: t('Über mehrere Terminvorschläge abstimmen'),
      icon: <HowToVoteRounded />,
      group: 'planning',
    },
    contacts: {
      label: t('Kontakte'),
      text: t('Adressbücher mit CardDAV, dazu Geburtstage im Kalender'),
      icon: <ContactsRounded />,
      group: 'people',
    },
    mail: { label: t('E-Mail'), text: t('Deine Postfächer per IMAP und SMTP direkt im Browser'), icon: <MailRounded />, group: 'people' },
    chat: {
      label: t('Chat'),
      text: t('Nachrichten an einzelne Personen und Gruppen, live auf allen Geräten'),
      icon: <ForumRounded />,
      group: 'people',
    },
    bookmarks: { label: t('Lesezeichen'), text: t('Links sammeln, ordnen und später lesen'), icon: <BookmarksRounded />, group: 'web' },
    feeds: {
      label: t('Feeds'),
      text: t('Neuigkeiten von Webseiten und Podcasts per RSS und Atom'),
      icon: <RssFeedRounded />,
      group: 'web',
    },
    snippets: {
      label: t('Schnipsel'),
      text: t('Texte und Code über einen Link teilen, auf Wunsch nur einmal lesbar'),
      icon: <CodeRounded />,
      group: 'web',
    },
  };
  return FEATURES.map((key) => ({ key, ...info[key], parent: FEATURE_PARENT[key] }));
}

export const groupLabel = (group: AppGroup) =>
  ({ media: t('Dateien und Medien'), planning: t('Planen'), people: t('Menschen und Nachrichten'), web: t('Web und Teilen') })[group];

export const APP_GROUPS: AppGroup[] = ['media', 'planning', 'people', 'web'];
