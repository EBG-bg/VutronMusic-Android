<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import { buildInfo } from '../platform/buildInfo'
import OriginalIcon from './OriginalIcon.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import AppUpdateSettings from './AppUpdateSettings.vue'
import LanguageSettings from './LanguageSettings.vue'
import LocalDirectoryManagement from './LocalDirectoryManagement.vue'
import UserBackupSettings from './UserBackupSettings.vue'
import CacheSettings from './CacheSettings.vue'
import LyricOverlaySettings from './LyricOverlaySettings.vue'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'

const store = useAndroidShellStore()
const emit = defineEmits<{ requestLogin: []; localMode: []; openOffline: [] }>()

function setSleepTimerFromInput() {
  void store.setSleepTimer(Number(store.sleepTimerMinutes))
}
</script>

<template>
<section class="page settings-page">
        <div class="section-heading"><div><div class="eyebrow">{{ $t('mobile.settingsUi.preferences') }}</div><h2>{{ $t('nav.settings') }}</h2><p class="setting-note">{{ buildInfo.displayName }} · {{ buildInfo.version }}</p></div></div>
        <section v-if="store.loggedIn" class="settings-card account-settings">
          <div class="settings-avatar">{{ store.profile?.nickname?.slice(0, 1) || 'V' }}</div>
          <div class="settings-account-copy"><b>{{ store.profile?.nickname }}</b><small>{{ $t('mobile.settingsUi.account') }}</small></div>
          <button type="button" class="text-button" @click="store.logout">{{ $t('mobile.settingsUi.logout') }}</button>
        </section>
        <section v-else class="settings-card account-settings">
          <div class="settings-avatar"><OriginalIcon name="local" /></div>
          <div class="settings-account-copy"><b>{{ $t('mobile.login.localEntry') }}</b><small>{{ $t('mobile.settingsUi.guestHint') }}</small></div>
          <button type="button" class="text-button" @click="emit('requestLogin')">{{ $t('mobile.settingsUi.login') }}</button>
        </section>
        <section class="settings-card network-settings"><div class="settings-detail"><span>{{ $t('mobile.network.manualSwitch') }}</span><button class="switch" :class="{ on: store.manualLocalOnly }" type="button" role="switch" :aria-checked="store.manualLocalOnly" :aria-label="$t('mobile.network.manualSwitch')" :disabled="store.localModeLoading" @click="store.manualLocalOnly ? store.useAutomaticMode() : emit('localMode')"><i></i></button></div><p class="setting-note">{{ $t(store.manualLocalOnly ? 'mobile.network.manualHint' : 'mobile.network.autoModeHint') }}</p><p class="setting-note" role="status">{{ $t(store.manualLocalOnly ? 'mobile.network.manualOffline' : store.localOnly ? !store.networkConnected ? 'mobile.network.automaticOffline' : 'mobile.network.localGuest' : 'mobile.network.online') }}</p></section>
        <AppearanceSettings />
        <LanguageSettings />
        <CollapsibleSettingsCard section-id="sources" :title="$t('mobile.settingsUi.sources')">
          <template #heading><span class="settings-icon violet"><OriginalIcon name="explore" /></span><div><h3>{{ $t('mobile.settingsUi.sources') }}</h3><p>{{ $t('mobile.settingsUi.sourcesSubtitle') }}</p></div></template>
          <label class="settings-detail"><span>{{ $t('mobile.settingsUi.autoSources') }}</span><input type="checkbox" :checked="store.autoMatchSources" @change="store.setAutoMatchSources(($event.target as HTMLInputElement).checked)" /></label>
          <p class="setting-note">{{ $t('mobile.settingsUi.sourcesHint') }}</p>
        </CollapsibleSettingsCard>
        <CollapsibleSettingsCard section-id="local" :title="$t('nav.localMusic')">
          <template #heading><span class="settings-icon violet"><OriginalIcon name="local" /></span><div><h3>{{ $t('nav.localMusic') }}</h3><p>{{ $t('mobile.settingsUi.localSubtitle') }}</p></div></template>
          <div class="settings-detail"><span>{{ store.folderName }}</span><button class="secondary-button" type="button" @click="store.pickMusicFolder">{{ $t('mobile.library.chooseFolder') }}</button></div>
          <button class="wide-outline-button" type="button" :disabled="store.localScanLoading" @click="store.loadLocalMusic(true)">{{ $t('mobile.settingsUi.rescan', { count: store.localTracks.length }) }}</button>
        </CollapsibleSettingsCard>
        <LocalDirectoryManagement />
        <CacheSettings @open-offline="emit('openOffline')" />
        <CollapsibleSettingsCard section-id="timer" :title="$t('mobile.settingsUi.timer')">
          <template #heading><span class="settings-icon coral"><OriginalIcon name="timer" /></span><div><h3>{{ $t('mobile.settingsUi.timer') }}</h3><p>{{ $t(store.sleepTimerRemainingMs > 0 ? 'mobile.settingsUi.timerRemaining' : 'mobile.settingsUi.timerHint', { time: store.sleepTimerLabel }) }}</p></div></template>
          <div class="settings-detail"><label for="sleep-timer-minutes">{{ $t('settings.lyric.minute') }}</label><input id="sleep-timer-minutes" v-model.number="store.sleepTimerMinutes" type="number" min="1" max="1440" inputmode="numeric" /></div>
          <div class="timer-actions"><button class="secondary-button" type="button" @click="setSleepTimerFromInput">{{ $t('mobile.settingsUi.startTimer') }}</button><button class="text-button" type="button" :disabled="!store.sleepTimerRemainingMs" @click="store.clearSleepTimer">{{ $t('mobile.settingsUi.cancelTimer') }}</button></div>
        </CollapsibleSettingsCard>
        <LyricOverlaySettings />
        <UserBackupSettings />
        <AppUpdateSettings @about="store.navigateTo('about')" />
      </section>
</template>
