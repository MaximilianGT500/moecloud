import { forwardRef, type ReactElement, type Ref } from 'react';
import Fade from '@mui/material/Fade';
import Slide from '@mui/material/Slide';
import type { TransitionProps } from '@mui/material/transitions';

const phone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 599.95px)').matches;

export const SheetTransition = forwardRef(function SheetTransition(props: TransitionProps & { children: ReactElement }, ref: Ref<unknown>) {
  if (phone()) return <Slide direction="up" ref={ref} {...props} />;
  return <Fade ref={ref} {...props} />;
});
