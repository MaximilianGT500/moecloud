import { useSyncExternalStore, type ReactElement } from 'react';
import BarChartRounded from '@mui/icons-material/BarChartRounded';
import BoltRounded from '@mui/icons-material/BoltRounded';
import BuildRounded from '@mui/icons-material/BuildRounded';
import CloudRounded from '@mui/icons-material/CloudRounded';
import CodeRounded from '@mui/icons-material/CodeRounded';
import DescriptionRounded from '@mui/icons-material/DescriptionRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import ExtensionOutlined from '@mui/icons-material/ExtensionOutlined';
import ExtensionRounded from '@mui/icons-material/ExtensionRounded';
import ImageRounded from '@mui/icons-material/ImageRounded';
import LabelRounded from '@mui/icons-material/LabelRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import ShareRounded from '@mui/icons-material/ShareRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import { api, errorText } from '../../lib/api';
import { boot, type PluginAction, type PluginBoot, type PluginIcon, type PluginPage } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { navigate } from '../../lib/router';
import { confirm } from './dialogs';
import { toast } from './toast';

export function pluginIcon(name: PluginIcon | string, outlined = false): ReactElement {
  switch (name) {
    case 'bolt':
      return <BoltRounded />;
    case 'chart':
      return <BarChartRounded />;
    case 'send':
      return <SendRounded />;
    case 'label':
      return <LabelRounded />;
    case 'print':
      return <PrintRounded />;
    case 'cloud':
      return <CloudRounded />;
    case 'star':
      return <StarRounded />;
    case 'build':
      return <BuildRounded />;
    case 'image':
      return <ImageRounded />;
    case 'document':
      return <DescriptionRounded />;
    case 'lock':
      return <LockRounded />;
    case 'download':
      return <DownloadRounded />;
    case 'share':
      return <ShareRounded />;
    case 'schedule':
      return <ScheduleRounded />;
    case 'code':
      return <CodeRounded />;
    default:
      return outlined ? <ExtensionOutlined /> : <ExtensionRounded />;
  }
}

const EMPTY: PluginBoot = { actions: [], pages: [] };
let current: PluginBoot = boot().setup2fa ? EMPTY : (boot().plugins ?? EMPTY);
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const usePlugins = () => useSyncExternalStore(subscribe, () => current);

export async function refreshPlugins() {
  try {
    current = await api.get<PluginBoot>('/api/plugins');
    listeners.forEach((listener) => listener());
  } catch {}
}

export const pluginPages = (): PluginPage[] => current.pages;

export const pluginPageHref = (page: Pick<PluginPage, 'plugin' | 'id'>) => `/files/plugins/${page.plugin}/${page.id}`;

export const pluginPageKey = (page: Pick<PluginPage, 'plugin' | 'id'>) => `plugin:${page.plugin}/${page.id}` as const;

interface Target {
  id: string;
  name: string;
  type: 'file' | 'folder';
}

const extensionOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

export function pluginActionsFor(targets: Target[]): PluginAction[] {
  const actions = current.actions;
  if (targets.length === 0 || actions.length === 0) return [];
  return actions.filter(
    (action) =>
      (action.multiple || targets.length === 1) &&
      targets.every(
        (item) =>
          action.kinds.includes(item.type) &&
          (item.type !== 'file' || !action.extensions || action.extensions.includes(extensionOf(item.name)))
      )
  );
}

export async function runPluginAction(action: PluginAction, targets: Target[]): Promise<boolean> {
  if (action.confirm && !(await confirm({ title: action.label, text: action.confirm, confirm: action.label }))) return false;
  try {
    const result = await api.post<{ message: string | null; open: string | null; refresh: boolean }>(
      `/api/plugins/${action.plugin}/actions/${action.id}`,
      { ids: targets.map((item) => item.id) }
    );
    const target = result.open;
    if (target && /^\/files(\/|\?|$)/.test(target)) {
      navigate(target);
      if (result.message) toast(result.message);
    } else if (target) {
      toast(result.message ?? t('„{name}“ ist fertig', { name: action.label }), {
        action: {
          label: t('Öffnen'),
          onClick: () => {
            if (target.startsWith('/')) location.assign(target);
            else window.open(target, '_blank', 'noopener,noreferrer');
          },
        },
      });
    } else {
      toast(result.message ?? t('„{name}“ ist fertig', { name: action.label }));
    }
    return result.refresh;
  } catch (error) {
    toast(errorText(error));
    return false;
  }
}
