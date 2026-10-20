import { createFileRoute } from '@tanstack/react-router';
import { PreferencesSettings } from '@/components/settings/preferences-settings';

export const Route = createFileRoute('/_app/settings/preferences')({
  component: PreferencesSettings,
});
