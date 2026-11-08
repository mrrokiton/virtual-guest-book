import { ToastProvider } from '@/components/ui/toast';

export default function BingoLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
