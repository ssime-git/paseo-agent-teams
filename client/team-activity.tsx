import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useRpc, type PluginTimelineItemProps } from '@getpaseo/plugin/client';
import { z } from 'zod';
import { roles, type Workflow } from '../shared/contracts';
import { plannerQuestionReadRpc, teamActivityReadRpc } from '../shared/planner-question';
import { roleTitle } from '../shared/team-composition';
import { useT } from './i18n';

export const teamActivitySchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    operationId: z.string(),
    role: z.enum(roles),
    model: z.string(),
    description: z.string(),
  })
  .strict();

/** One live card per operation. Completed work remains in the native sub-agent row. */
export function TeamActivity({
  item: { data },
  agentId,
  theme: { colors: c },
}: PluginTimelineItemProps<z.infer<typeof teamActivitySchema>>) {
  const t = useT();
  const read = useRpc(plannerQuestionReadRpc);
  const activityRead = useRpc(teamActivityReadRpc);
  const activityRef = useRef(activityRead);
  activityRef.current = activityRead;
  const readRef = useRef(read);
  readRef.current = read;
  const [workflow, setWorkflow] = useState<Workflow>();
  const [activity, setActivity] = useState<{ toolName: string; summary?: string }[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true,
      pending = false;
    setWorkflow(undefined);
    setActivity([]);
    setError(false);
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const w = await readRef.current({ id: data.id, workspaceId: data.workspaceId, ownerAgentId: agentId });
        if (!live) return;
        setWorkflow(w);
        setError(false);
        if (w.operation?.id !== data.operationId) {
          clearInterval(timer);
        } else {
          const items = await activityRef
            .current({
              id: data.id,
              workspaceId: data.workspaceId,
              ownerAgentId: agentId,
              operationId: data.operationId,
            })
            .catch(() => undefined);
          if (live && Array.isArray(items)) setActivity(items);
        }
      } catch {
        if (live) setError(true);
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void refresh(), 1000);
    void refresh();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [data.id, data.workspaceId, data.operationId, agentId]);
  if (workflow && workflow.operation?.id !== data.operationId) return null;
  const tasks =
    data.role === 'builder' ? workflow?.plan?.tasks : data.role === 'reviewer' ? workflow?.plan?.acceptance : undefined;
  const state = error
    ? t('Actualisation indisponible')
    : !workflow
      ? t('Actualisation…')
      : workflow.status === 'permission'
        ? t('Autorisation attendue')
        : workflow.status === 'paused'
          ? t('Équipe en pause')
          : t('En cours');
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        borderWidth: 1,
        borderColor: c.accent,
        borderRadius: 12,
        backgroundColor: c.surface1,
        padding: 14,
        gap: 8,
        minWidth: 0,
      }}
    >
      <Text style={{ color: c.accent, fontWeight: '600', fontSize: 13 }}>
        {t(roleTitle[data.role])} · {data.model}
      </Text>
      <Text style={{ color: c.foreground, fontWeight: '600' }}>{state}</Text>
      <Text style={{ color: c.foreground, fontSize: 13, lineHeight: 19 }}>{data.description}</Text>
      {tasks?.length ? (
        <View style={{ gap: 5 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t('Sous-tâches à traiter')}</Text>
          {tasks.map((task, i) => (
            <Text key={i} style={{ color: c.foreground, fontSize: 12, lineHeight: 18 }}>
              {i + 1}. {task}
            </Text>
          ))}
        </View>
      ) : null}
      {activity.length ? (
        <View style={{ gap: 5 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t('Dans le fil du sous-agent')}</Text>
          {activity.map(({ toolName, summary }, i) => (
            <Text key={i} style={{ color: c.foreground, fontSize: 12, lineHeight: 18 }}>
              {[toolName, summary].filter(Boolean).join(' · ')}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
