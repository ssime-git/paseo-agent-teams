import { useSyncExternalStore } from 'react';
import type { Config } from '../shared/contracts';
import { initialConfig } from './configuration';

type ViewState = { showNew: boolean; showConfig: boolean; selected: string };
type Draft = { config: Config; task: string; view: ViewState };
const drafts = new Map<string, Draft>();
const listeners = new Map<string, Set<() => void>>();
export function prepareNewTeam(key: string) {
  const current = drafts.get(key) ?? {
    config: initialConfig(),
    task: '',
    view: { showNew: false, showConfig: false, selected: '' },
  };
  drafts.set(key, { ...current, view: { ...current.view, showNew: true, showConfig: true } });
  listeners.get(key)?.forEach((listener) => listener());
}
export function useTeamDraft(key: string) {
  const snapshot = () => {
    if (!drafts.has(key))
      drafts.set(key, { config: initialConfig(), task: '', view: { showNew: false, showConfig: false, selected: '' } });
    return drafts.get(key)!;
  };
  const draft = useSyncExternalStore(
    (callback) => {
      const group = listeners.get(key) ?? new Set();
      group.add(callback);
      listeners.set(key, group);
      return () => {
        group.delete(callback);
        if (!group.size) listeners.delete(key);
      };
    },
    snapshot,
    snapshot,
  );
  const setConfig = (value: Config | ((current: Config) => Config)) => {
    const current = snapshot();
    drafts.set(key, { ...current, config: typeof value === 'function' ? value(current.config) : value });
    listeners.get(key)?.forEach((listener) => listener());
  };
  const setTask = (task: string) => {
    drafts.set(key, { ...snapshot(), task });
    listeners.get(key)?.forEach((listener) => listener());
  };
  const setView = (patch: Partial<ViewState>) => {
    const current = snapshot();
    drafts.set(key, { ...current, view: { ...current.view, ...patch } });
    listeners.get(key)?.forEach((listener) => listener());
  };
  return { ...draft, setConfig, setTask, setView };
}
