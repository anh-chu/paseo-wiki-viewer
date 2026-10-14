import { openExternalUrl, useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { describeWikiVersion, prepareWiki, updateWiki } from "../shared/wiki";
import { canEmbed, WikiFrame } from "./web";

// Grants live 30 minutes after their last use. Refreshing every 10 keeps the
// URL ready, so a press opens it synchronously (browsers block a new tab
// opened after an awaited request).
const PREPARE_INTERVAL_MS = 10 * 60 * 1000;

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function WikiPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const queryClient = useQueryClient();
  const describeVersion = useRpc(describeWikiVersion);
  const prepare = useRpc(prepareWiki);
  const update = useRpc(updateWiki);

  const version = useQuery({ queryKey: ["wiki", "version"], queryFn: () => describeVersion({}) });
  const installed = version.data?.installed != null;
  const target = useQuery({
    queryKey: ["wiki", "prepare", workspaceId],
    queryFn: () => prepare({ workspaceId }),
    enabled: installed,
    refetchInterval: PREPARE_INTERVAL_MS,
    retry: false,
  });
  const install = useMutation({
    mutationFn: () => update({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wiki"] }),
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      body: { padding: layout.compact ? 16 : 24, gap: 12 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 20, fontWeight: "600" as const },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      row: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: 8 },
      value: { color: theme.colors.foreground, fontSize: 13, fontFamily: "monospace", flexShrink: 1 },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      primary: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.colors.accent },
      primaryText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      secondary: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 },
      secondaryText: { color: theme.colors.foreground },
      disabled: { opacity: 0.5 },
      toolbar: { padding: 6, borderBottomWidth: 1, borderColor: theme.colors.border },
      small: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 },
    }),
    [theme, layout.compact],
  );

  const info = version.data;
  const url = target.data?.url;
  // The frame keeps its first URL: the grant stays alive while the frame uses
  // it, and swapping in each refreshed URL would reload the page.
  const [frameUrl, setFrameUrl] = useState<string | undefined>();
  useEffect(() => {
    if (url && !frameUrl) setFrameUrl(url);
  }, [url, frameUrl]);
  const openBrowser = navigation?.openBrowser;
  const open = () => {
    if (!url) return;
    if (openBrowser) openBrowser({ url, workspaceId });
    else void openExternalUrl(url);
  };

  const installLabel = install.isPending
    ? "Installing…"
    : info?.installed == null
      ? "Install wiki-viewer"
      : info.latest !== null && info.updateAvailable
        ? `Update to ${info.latest}`
        : "Up to date";
  const canInstall = !install.isPending && info?.managed === true && (info.installed === null || info.updateAvailable);

  if (canEmbed && frameUrl) {
    return (
      <View style={styles.screen}>
        <View style={[styles.actions, styles.toolbar]}>
          <Pressable accessibilityRole="button" onPress={() => {
              // A fresh prepare restarts a dead viewer and yields a new grant, so the frame remounts.
              void target.refetch().then(({ data }) => data && setFrameUrl(data.url));
            }} style={styles.small}>
            <Text style={styles.secondaryText}>Reload</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={open} style={styles.small}>
            <Text style={styles.secondaryText}>Open in tab</Text>
          </Pressable>
        </View>
        <WikiFrame key={frameUrl} url={frameUrl} title="Wiki Viewer" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Text style={styles.title}>Wiki Viewer</Text>
      <Text style={styles.muted}>Browse this workspace's files in wiki-viewer.</Text>

      {version.isPending ? <Text style={styles.muted}>Checking versions…</Text> : null}
      {version.error ? <Text style={styles.error}>{message(version.error, "Version check failed.")}</Text> : null}

      {info ? (
        <View style={{ gap: 4 }}>
          <View style={styles.row}>
            <Text style={styles.muted}>Installed</Text>
            <Text style={styles.value}>{info.installed ?? "not installed"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.muted}>Latest release</Text>
            <Text style={styles.value}>{info.latest ?? (info.latestError !== "" ? `check failed (${info.latestError})` : "unknown")}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.muted}>Location</Text>
            <Text style={styles.value}>{info.root}</Text>
          </View>
          {info.managed ? null : <Text style={styles.muted}>A custom viewer root is set in Settings; update that install manually.</Text>}
          {info.checkout ? <Text style={styles.muted}>Source checkout without a production build. Build it there first.</Text> : null}
        </View>
      ) : null}

      {target.error ? <Text style={styles.error}>{message(target.error, "Wiki Viewer unavailable.")}</Text> : null}
      {install.error ? <Text style={styles.error}>{message(install.error, "Install failed.")}</Text> : null}
      {install.data ? (
        <Text style={styles.muted}>
          {install.data.updated ? `Installed wiki-viewer ${install.data.version}.` : `Already on the latest release (${install.data.version ?? "unknown"}).`}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {installed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the workspace in Wiki Viewer"
            disabled={!url}
            onPress={open}
            style={[styles.primary, !url && styles.disabled]}
          >
            <Text style={styles.primaryText}>{target.isPending ? "Starting Wiki Viewer…" : "Open wiki"}</Text>
          </Pressable>
        ) : null}
        {target.error ? (
          <Pressable accessibilityRole="button" onPress={() => void target.refetch()} style={styles.secondary}>
            <Text style={styles.secondaryText}>Retry</Text>
          </Pressable>
        ) : null}
        {info ? (
          <Pressable
            accessibilityRole="button"
            disabled={!canInstall}
            onPress={() => install.mutate()}
            style={[styles.secondary, !canInstall && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{installLabel}</Text>
          </Pressable>
        ) : null}
        {version.error ? (
          <Pressable accessibilityRole="button" onPress={() => void version.refetch()} style={styles.secondary}>
            <Text style={styles.secondaryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
      {url && !openBrowser ? <Text style={styles.muted}>Opens in your browser. The link reaches the daemon machine over the network.</Text> : null}
    </ScrollView>
  );
}
