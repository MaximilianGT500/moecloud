import type { ReactNode } from 'react';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { c } from '../../theme/tokens';

export interface Action {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
  primary?: boolean;
}

export type Anchor = HTMLElement | { x: number; y: number } | null;

export function ActionMenu({ anchor, actions, onClose }: { anchor: Anchor; actions: Action[]; onClose: () => void }) {
  const position = anchor && !(anchor instanceof HTMLElement) ? anchor : null;
  return (
    <Menu
      open={Boolean(anchor) && actions.length > 0}
      onClose={onClose}
      anchorEl={anchor instanceof HTMLElement ? anchor : null}
      anchorReference={position ? 'anchorPosition' : 'anchorEl'}
      anchorPosition={position ? { top: position.y, left: position.x } : undefined}
      slotProps={{ list: { dense: false } }}
    >
      {actions.flatMap((action) => [
        action.divider ? <Divider key={`${action.key}-divider`} sx={{ my: 0.5 }} /> : null,
        <MenuItem
          key={action.key}
          onClick={() => {
            onClose();
            action.onClick();
          }}
          sx={action.danger ? { color: c.error, '& .MuiListItemIcon-root': { color: c.error } } : undefined}
        >
          <ListItemIcon>{action.icon}</ListItemIcon>
          <ListItemText>{action.label}</ListItemText>
        </MenuItem>,
      ])}
    </Menu>
  );
}

export function ActionButtons({ actions, limit = 4 }: { actions: Action[]; limit?: number }) {
  return (
    <>
      {actions
        .filter((action) => action.primary)
        .slice(0, limit)
        .map((action) => (
          <Tooltip key={action.key} title={action.label}>
            <IconButton aria-label={action.label} onClick={action.onClick}>
              {action.icon}
            </IconButton>
          </Tooltip>
        ))}
    </>
  );
}
