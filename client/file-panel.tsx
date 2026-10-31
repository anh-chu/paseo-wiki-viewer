import { openExternalUrl, useRpc, type PluginFilePanelProps } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { openWikiFile } from "../shared/wiki";
import { canEmbed, WikiFrame } from "./web";

// Grants live 30 minutes after their last use; the frame keeps its grant alive,
// so the URL is fetched once per file and never refreshed under the frame.
export function WikiFilePanel({
  theme,
  workspaceId,
  file,
  navigation,
  showInSidebar,
}: PluginFilePanelProps & { showInSidebar(url: string): void }) {
  const open = useRpc(openWikiFile);
  const target = useQuery({
    queryKey: ["wiki", "file", workspaceId, file.path],
    queryFn: () => open({ workspaceId, path: file.path }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  if (target.isPending) return <Loading />;
  if (target.error) {
    return (
      <View style={{ flex: 1, padding: 24, gap: 12, backgroundColor: theme.colors.surface0 }}>
        <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>{target.error.message}</Text>
        <Pressable accessibilityRole="button" onPress={() => void target.refetch()}>
          <Text style={{ color: theme.colors.foreground }}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  const url = target.data.url;
  if (canEmbed) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
        <View style={{ flexDirection: "row", padding: 6, borderBottomWidth: 1, borderColor: theme.colors.border }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => showInSidebar(url)}
            style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}
          >
            <Text style={{ color: theme.colors.foreground }}>Show in sidebar</Text>
          </Pressable>
        </View>
        <WikiFrame key={url} url={url} title={file.name} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: theme.colors.surface0 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => (navigation?.openBrowser ? navigation.openBrowser({ url, workspaceId }) : void openExternalUrl(url))}
      >
        <Text style={{ color: theme.colors.foreground }}>Open in Wiki Viewer</Text>
      </Pressable>
    </View>
  );
}
