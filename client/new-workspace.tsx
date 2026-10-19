import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { usePaseo, type PluginScreenProps, type PluginSidebarItemProps } from '@getpaseo/plugin/client';
import { SidebarRow } from '@getpaseo/plugin/client/ui';
import type { PaseoProject } from '@getpaseo/client';
import { errorMessage } from './errors';
import { prepareNewTeam } from './drafts';

export const NEW_TEAM_SCREEN = 'new-agent-workspace';

export function NewTeamSidebar({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Workflow"
      active={currentScreen?.screenId === NEW_TEAM_SCREEN}
      onPress={() => openScreen({ screenId: NEW_TEAM_SCREEN })}
    />
  );
}

/** Global entry: choose a repository before any native agent has been created. */
export function NewTeamWorkspace({ theme, host, onOpen }: PluginScreenProps & { onOpen(workspaceId: string): void }) {
  const paseo = usePaseo();
  const [projects, setProjects] = useState<PaseoProject[]>([]);
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  const c = theme.colors;
  useEffect(() => {
    let live = true;
    paseo.projects.list().then(
      ({ projects }) => {
        if (live) setProjects(projects);
      },
      (error) => {
        if (live) setError(errorMessage(error));
      },
    );
    return () => {
      live = false;
    };
  }, [paseo]);
  const open = async (path: string) => {
    if (opening.current || !path.trim()) return;
    opening.current = true;
    setBusy(true);
    setError('');
    try {
      // Opening the directory creates/reuses only the workspace, never a chat agent.
      const workspace = await paseo.workspaces.open(path.trim());
      prepareNewTeam(`${host.id}:${workspace.id}`);
      onOpen(workspace.id);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      opening.current = false;
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: c.foreground, fontSize: 24, fontWeight: '600' }}>Nouveau workspace agent</Text>
      <Text style={{ color: c.foregroundMuted }}>Plan → Build → Tests → Review · Hôte : {host.label}</Text>
      <Text style={{ color: c.foregroundMuted }}>
        Choisissez un projet, puis configurez les trois rôles de votre équipe.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>
          {error}
        </Text>
      ) : null}
      <View style={{ gap: 8 }}>
        <TextInput
          accessibilityLabel="Dossier du workspace agent"
          placeholder="Chemin absolu du projet sur cet hôte"
          placeholderTextColor={c.foregroundMuted}
          value={directory}
          onChangeText={setDirectory}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => void open(directory)}
          style={{ color: c.foreground, padding: 12, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Configurer l’équipe"
          disabled={busy || !directory.trim()}
          onPress={() => void open(directory)}
          style={{
            padding: 12,
            borderRadius: 8,
            backgroundColor: c.surface2,
            opacity: busy || !directory.trim() ? 0.5 : 1,
          }}
        >
          <Text style={{ color: c.foreground }}>{busy ? 'Ouverture…' : 'Configurer l’équipe'}</Text>
        </Pressable>
      </View>
      {projects.map((project) => (
        <Pressable
          key={project.projectId}
          accessibilityRole="button"
          accessibilityLabel={`Mode agent : ${project.projectDisplayName}`}
          disabled={busy}
          onPress={() => void open(project.projectRootPath)}
          style={{ padding: 14, gap: 4, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}
        >
          <Text style={{ color: c.foreground, fontWeight: '600' }}>{project.projectDisplayName}</Text>
          <Text style={{ color: c.foregroundMuted }}>{project.projectRootPath}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
