import { useEffect, useState } from 'react';
import { useT } from './i18n';
import type { ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  usePaseo,
  type PluginClientContext,
  type PluginHostProps,
  type PluginButtonRegistration,
} from '@getpaseo/plugin/client';
import { QuickStart } from './quick-start';
import { prepareNewTeam } from './drafts';
import { errorMessage } from './errors';
import { HISTORY_SCREEN } from './routes';

export type CreationPillProps = PluginHostProps & {
  context: 'new-workspace';
  cwd: string | null;
  task: string;
  close(): void;
};

/** Optional host API supplied by the accompanying Paseo client extension. */
type CreationClient = PluginClientContext & {
  addNewWorkspaceComposerPill?(input: {
    id: string;
    button: {
      title: string;
      label: string;
      icon: string;
      behavior: { kind: 'popover'; Content: ComponentType<CreationPillProps> };
    };
  }): PluginButtonRegistration;
};

export function addCreationAccess(client: PluginClientContext) {
  const extended = client as CreationClient;
  const pill = extended.addNewWorkspaceComposerPill?.({
    id: 'agent-teams',
    button: {
      title: 'Team Auto',
      label: 'Team Auto',
      icon: 'Workflow',
      behavior: {
        kind: 'popover',
        Content: (props) => (
          <CreationTeam
            {...props}
            onOpenHistory={() => client.openScreen({ screenId: HISTORY_SCREEN })}
            onOpen={(workspaceId) => client.openPanel('agent-teams', { workspaceId })}
          />
        ),
      },
    },
  });
  return () => pill?.remove();
}

export function CreationTeam(props: CreationPillProps & { onOpen(workspaceId: string): void; onOpenHistory?(): void }) {
  const t = useT();
  const paseo = usePaseo();
  const [workspaceId, setWorkspaceId] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setWorkspaceId('');
    setError('');
    if (props.cwd) {
      paseo.workspaces.open(props.cwd).then(
        (workspace) => {
          if (!live) return;
          prepareNewTeam(`${props.host.id}:${workspace.id}`, props.task);
          setWorkspaceId(workspace.id);
        },
        (error) => {
          if (live) setError(errorMessage(error, t));
        },
      );
    }
    return () => {
      live = false;
    };
  }, [paseo, props.cwd, props.host.id, retry]);
  if (workspaceId) {
    return (
      <QuickStart
        {...props}
        context="workspace"
        workspaceId={workspaceId}
        openHistory={props.onOpenHistory}
        openPanel={(target) => props.onOpen(target ?? workspaceId)}
      />
    );
  }
  return (
    <View style={{ padding: 16, maxWidth: 380, gap: 12 }}>
      <Text style={{ color: props.theme.colors.foreground }}>
        {error ||
          (props.cwd
            ? t('Préparation du mode agent…')
            : t('Choisissez le projet sur cet hôte pour configurer l’équipe.'))}
      </Text>
      {error ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Réessayer le mode agent')}
          onPress={() => setRetry((value) => value + 1)}
        >
          <Text style={{ color: props.theme.colors.foreground }}>{t('Réessayer')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
