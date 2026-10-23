import { useRef, useState } from 'react';
import { useT } from './i18n';
import type { Translate } from '../shared/i18n';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRpc, type PluginHostProps } from '@getpaseo/plugin/client';
import { actionRpc, listRpc, type Workflow } from '../shared/contracts';
import { errorMessage } from './errors';
import { translator } from '../shared/i18n';
const french = translator('fr');

export function workflowHeadline(w: Workflow, t: Translate = french) {
  if (w.status !== 'completed' && w.clarifications?.some((v) => !v.resolvedAt)) return t('En attente de réponse');
  if (w.status === 'attention') return w.error?.includes('Budget') ? t('Budget atteint') : t('L’équipe peut reprendre');
  if (w.status === 'paused') return t('Workflow en pause');
  if (w.status === 'permission') return t('Une autorisation est attendue');
  if (w.status === 'awaiting_plan') return t('Le plan est prêt à valider');
  if (w.status === 'awaiting_final') return t('Le résultat est prêt à valider');
  if (w.status === 'completed') return t('Objectif validé');
  return w.resultRepair
    ? t('Compte rendu en préparation')
    : w.phase === 'planning'
      ? t('Le Plan prépare la suite')
      : w.phase === 'building'
        ? t('Le Code développe et vérifie')
        : w.phase === 'testing'
          ? t('Vérifications en cours')
          : t('Revue indépendante en cours');
}
export function GoalAction({
  workflow: w,
  colors: c,
  busy,
  onContinue,
}: {
  workflow: Workflow;
  colors: PluginHostProps['theme']['colors'];
  busy: boolean;
  onContinue(): void;
}) {
  const t = useT();
  const checkpoint = ['attention', 'paused'].includes(w.status) && !w.clarifications?.some((v) => !v.resolvedAt);
  return (
    <View style={{ gap: 9 }}>
      <Text style={{ color: c.foreground, fontWeight: '600', fontSize: 14 }}>{workflowHeadline(w, t)}</Text>
      {checkpoint ? (
        <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {w.operation
            ? t('Le tour enregistré sera réconcilié avant toute nouvelle action.')
            : t('Reprendre le diagnostic, corriger et vérifier. Le travail et le contexte sont conservés.')}
        </Text>
      ) : null}
      {checkpoint && w.config.mode === 'auto' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Poursuivre jusqu’à l’objectif')}
          disabled={busy}
          onPress={onContinue}
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 15,
            paddingVertical: 11,
            borderRadius: 8,
            backgroundColor: c.accent,
            opacity: busy ? 0.55 : 1,
          }}
        >
          <Text style={{ color: c.accentForeground, fontSize: 13, fontWeight: '600' }}>
            {busy ? t('Reprise en cours…') : t('Poursuivre jusqu’à l’objectif →')}
          </Text>
        </Pressable>
      ) : null}
      {w.config.goalMode ? (
        <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
          {w.goal?.turns ?? 0}/{w.config.goalMaxTurns ?? 30} tours · {w.goal?.replans ?? 0} replanifications
        </Text>
      ) : null}
    </View>
  );
}
/** The native message uses live workflow state, so old cards never offer a stale action. */
export function LiveWorkflowAction({
  workflowId,
  workspaceId,
  colors: c,
  hostId,
  onOpen,
  eventId,
  snapshot,
}: {
  workflowId: string;
  workspaceId: string;
  colors: PluginHostProps['theme']['colors'];
  hostId: string;
  onOpen(): void;
  eventId?: string;
  snapshot?: { cycle: number; phase: string };
}) {
  const t = useT();
  const list = useRpc(listRpc),
    action = useRpc(actionRpc);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef('');
  const query = useQuery({
    queryKey: ['team-native-state', hostId, workspaceId],
    queryFn: () => list({ workspaceId }),
    refetchInterval: 3000,
  });
  const w = query.data?.find((value) => value.id === workflowId);
  const current =
    w &&
    (!eventId ||
      w.events.filter((e) => e.kind === 'assistant' && e.role === w.events.find((e) => e.id === eventId)?.role).at(-1)
        ?.id === eventId) &&
    (!snapshot || (w.cycle === snapshot.cycle && w.phase === snapshot.phase));
  const proceed = async () => {
    if (!w || busy) return;
    setBusy(true);
    setError('');
    request.current ||= `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await action({
        id: w.id,
        workspaceId,
        expectedRevision: w.revision,
        requestId: request.current,
        action: w.operation ? 'resume' : 'start_goal',
      });
      request.current = '';
      await query.refetch();
    } catch (e) {
      setError(errorMessage(e, t));
      await query.refetch();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      {w && current ? <GoalAction workflow={w} colors={c} busy={busy} onContinue={() => void proceed()} /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12 }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Ouvrir le workflow Agent Teams')}
        onPress={onOpen}
        style={{ alignSelf: 'flex-start', paddingVertical: 6 }}
      >
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t('Ouvrir l’équipe ↗')}</Text>
      </Pressable>
    </View>
  );
}
