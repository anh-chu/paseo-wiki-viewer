import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { wikiSettings } from "../shared/wiki";

export function WikiSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(wikiSettings);
  if (settings.status !== "ready") {
    const text = settings.status === "loading" ? "Loading…" : String(settings.error);
    return <Text style={{ color: theme.colors.foregroundMuted }}>{text}</Text>;
  }
  return <Editor key={settings.revision} settings={settings} />;
}

type ReadySettings = Extract<ReturnType<typeof useSettings<typeof wikiSettings.schema>>, { status: "ready" }>;

function Editor({ settings }: { settings: ReadySettings }) {
  const [publicUrl, setPublicUrl] = useState(settings.values.publicUrl);
  const [port, setPort] = useState(String(settings.values.port));
  const [viewerRoot, setViewerRoot] = useState(settings.values.viewerRoot);
  const portValue = Number(port);
  const portError = Number.isInteger(portValue) && portValue >= 0 && portValue <= 65535 ? undefined : "Enter 0 to 65535.";
  const urlError = publicUrl === "" || /^https?:\/\/\S+$/.test(publicUrl) ? undefined : "Enter an http(s) URL.";

  return (
    <>
      <SettingsSection title="Chat">
        <SettingsCard>
          <SettingsSwitch
            label="Open chat file links in Wiki Viewer"
            hint="Clicking a file path in an agent's chat shows it in the sidebar. Alt-click always opens Paseo's file tab."
            value={settings.values.openChatLinks}
            disabled={settings.saving}
            onValueChange={(openChatLinks) => void settings.save({ ...settings.values, openChatLinks }, settings.revision)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Connection">
        <SettingsCard>
          <SettingsInput
            label="Public URL"
            hint="Base URL your devices use to reach the daemon, for example http://devvm:7791. Empty uses http://<daemon hostname>:<port>."
            initialValue={publicUrl}
            placeholder="http://hostname:port"
            error={urlError}
            onChangeText={setPublicUrl}
          />
          <SettingsInput
            label="Port"
            hint="Port of the access-checking proxy on the daemon machine. 0 picks a free port each start."
            initialValue={port}
            error={portError}
            onChangeText={setPort}
          />
          <SettingsInput
            label="Viewer root"
            hint="A built wiki-viewer install or checkout to run. Empty uses the managed install."
            initialValue={viewerRoot}
          placeholder="/path/to/wiki-viewer"
          onChangeText={setViewerRoot}
        />
        <SettingsAction
          label="Save"
          error={settings.saveError ? String(settings.saveError) : undefined}
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={settings.saving || portError !== undefined || urlError !== undefined}
          onPress={() => void settings.save({ ...settings.values, publicUrl: publicUrl.trim(), port: portValue, viewerRoot: viewerRoot.trim() }, settings.revision)}
        />
      </SettingsCard>
    </SettingsSection>
    </>
  );
}
