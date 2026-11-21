<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import OriginalIcon from './OriginalIcon.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import AppUpdateSettings from './AppUpdateSettings.vue'
import LanguageSettings from './LanguageSettings.vue'
import LocalDirectoryManagement from './LocalDirectoryManagement.vue'
import UserBackupSettings from './UserBackupSettings.vue'
import CacheSettings from './CacheSettings.vue'
import SettingsSwitchRow from './SettingsSwitchRow.vue'
import LyricOverlaySettings from './LyricOverlaySettings.vue'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import SleepTimerSettings from './SleepTimerSettings.vue'
import ProfileAvatar from './ProfileAvatar.vue'
import PluginSourcePrioritySettings from './PluginSourcePrioritySettings.vue'
import PlaybackSourcePolicySettings from './PlaybackSourcePolicySettings.vue'
import { playlistSortHints } from '../platform/interfacePreferences'
import { appNavigation } from '../composables/navigationGuard'

const store = useAndroidShellStore()
const emit = defineEmits<{ requestLogin: []; localMode: []; openOffline: []; openPlugins: [] }>()

</script>

<template>
<section class="page settings-page">
        <div class="section-heading"><div><h2>{{ $t('nav.settings') }}</h2></div></div>
        <h3 class="settings-group-label">{{ $t('mobile.experience.accountGroup') }}</h3>
        <section v-if="store.loggedIn" class="settings-card account-settings">
          <ProfileAvatar :user-id="store.profile!.userId" :nickname="store.profile!.nickname" :src="store.profile?.avatarUrl" />
          <div class="settings-account-copy"><b>{{ store.profile?.nickname }}</b><small>{{ $t('mobile.settingsUi.account') }}</small></div>
          <button type="button" class="text-button" @click="appNavigation.run(()=>store.logout())">{{ $t('mobile.settingsUi.logout') }}</button>
        </section>
        <section v-else class="settings-card account-settings">
          <div class="settings-avatar"><OriginalIcon name="local" /></div>
          <div class="settings-account-copy"><b>{{ $t('mobile.login.localEntry') }}</b><small>{{ $t('mobile.settingsUi.guestHint') }}</small></div>
          <button type="button" class="text-button" @click="appNavigation.run(()=>emit('requestLogin'))">{{ $t('mobile.settingsUi.login') }}</button>
        </section>
        <section class="settings-card network-settings"><div class="settings-detail"><div class="settings-network-copy"><b>{{ $t('mobile.network.manualSwitch') }}</b><small role="status">{{ $t(store.manualLocalOnly ? 'mobile.network.manualOffline' : store.localOnly ? !store.networkConnected ? 'mobile.network.automaticOffline' : 'mobile.network.localGuest' : 'mobile.network.online') }}</small></div><button class="switch" :class="{ on: store.manualLocalOnly }" type="button" role="switch" :aria-checked="store.manualLocalOnly" :aria-label="$t('mobile.network.manualSwitch')" :disabled="store.localModeLoading" @click="store.manualLocalOnly ? store.useAutomaticMode() : emit('localMode')"><i></i></button></div></section>
        <h3 class="settings-group-label">{{ $t('mobile.refinements.interfaceGroup') }}</h3>
        <AppearanceSettings />
        <LanguageSettings />
        <h3 class="settings-group-label">{{ $t('mobile.refinements.playbackGroup') }}</h3>
        <SleepTimerSettings />
        <LyricOverlaySettings />
        <h3 class="settings-group-label">{{ $t('mobile.experience.sourcesGroup') }}</h3>
        <button type="button" class="settings-card settings-source-link" @click="appNavigation.run(() => emit('openPlugins'))">
          <span class="settings-icon"><OriginalIcon name="explore" /></span><span>{{ $t('mobile.plugins.manageSources') }}</span><OriginalIcon name="down" class="settings-link-chevron" />
        </button>
        <PlaybackSourcePolicySettings />
        <PluginSourcePrioritySettings />
        <h3 class="settings-group-label">{{ $t('mobile.experience.storageGroup') }}</h3>
        <CollapsibleSettingsCard section-id="local" :title="$t('nav.localMusic')">
          <template #heading><span class="settings-icon violet"><OriginalIcon name="local" /></span><div><h3>{{ $t('nav.localMusic') }}</h3><p>{{ $t('mobile.settingsUi.localSubtitle') }}</p></div></template>
          <div class="settings-detail"><span>{{ store.folderName }}</span><button class="secondary-button" type="button" @click="store.pickMusicFolder">{{ $t('mobile.library.chooseFolder') }}</button></div>
          <button class="wide-outline-button" type="button" :disabled="store.localScanLoading" @click="store.loadLocalMusic(true)">{{ $t('mobile.settingsUi.rescan', { count: store.localTracks.length }) }}</button>
          <LocalDirectoryManagement />
          <SettingsSwitchRow :label="$t('mobile.ordering.showSortHints')" :checked="playlistSortHints" @change="playlistSortHints = $event" />
        </CollapsibleSettingsCard>
        <CacheSettings @open-offline="emit('openOffline')" />
        <UserBackupSettings />
        <h3 class="settings-group-label">{{ $t('mobile.refinements.applicationGroup') }}</h3>
        <AppUpdateSettings @about="appNavigation.run(()=>store.navigateTo('about'))" />
      </section>
</template>

<style scoped>
.settings-page > .settings-group-label:first-of-type { margin-top: 10px; }
.settings-network-copy { display: grid; gap: 5px; min-width: 0; }
.settings-network-copy b { font-weight: 650; }
.settings-network-copy small { color: var(--muted); line-height: 1.4; }
.settings-source-link { width: 100%; display: flex; align-items: center; gap: 12px; color: var(--ink); text-align: start; font-weight: 650; }
.settings-source-link > span:nth-child(2) { flex: 1; min-width: 0; }
.settings-link-chevron { transform: rotate(-90deg); color: var(--muted); }
</style>
