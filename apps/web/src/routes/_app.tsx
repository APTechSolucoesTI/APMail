import { createFileRoute } from '@tanstack/react-router';
import { requireCompany } from '@/lib/auth';
import { AppShell } from '@/components/layout/app-shell';
export const Route = createFileRoute('/_app')({ beforeLoad: requireCompany, component: AppShell });
