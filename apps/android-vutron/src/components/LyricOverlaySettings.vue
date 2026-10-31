<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import LyricColorPicker from './LyricColorPicker.vue'
import LyricOffsetControl from './LyricOffsetControl.vue'
import OriginalIcon from './OriginalIcon.vue'
import ThumbRange from './ThumbRange.vue'
const store = useAndroidShellStore()
</script>
<template>
<CollapsibleSettingsCard section-id="lyrics" :title="$t('settings.nav.osdLyric')">
          <template #heading><span class="settings-icon coral"><OriginalIcon name="lyrics" /></span><div><h3>{{ $t('settings.nav.osdLyric') }}</h3><p>{{ $t('mobile.settingsUi.overlaySubtitle') }}</p></div></template>
          <div class="settings-detail"><span>{{ $t('mobile.settingsUi.showOverlay') }}</span><button class="switch" :class="{ on: store.overlayEnabled }" type="button" role="switch" :aria-checked="store.overlayEnabled" @click="store.toggleLyricOverlay()"><i></i></button></div>
          <p class="setting-note">{{ $t('mobile.settingsUi.overlayPermission') }}</p>
          <div class="timer-actions"><button class="secondary-button" type="button" :disabled="!store.overlayEnabled" @click="store.temporarilyHideOverlay()">{{ $t('mobile.settingsUi.hideOverlay') }}</button><button class="secondary-button" type="button" :disabled="!store.overlayEnabled" @click="store.restoreOverlay()">{{ $t('mobile.settingsUi.restoreOverlay') }}</button></div>
          <label class="settings-detail"><span>{{ $t('mobile.settingsUi.validateLyrics') }}</span><input type="checkbox" :checked="store.overlaySettings.wifiValidation" @change="store.updateOverlayField('wifiValidation', ($event.target as HTMLInputElement).checked)" /></label>
          <label class="settings-detail"><span>{{ $t('mobile.settingsUi.estimateLyrics') }}</span><input type="checkbox" :checked="store.overlaySettings.estimatedWordTiming" @change="store.updateOverlayField('estimatedWordTiming', ($event.target as HTMLInputElement).checked)" /></label>
          <p class="setting-note">{{ $t('mobile.settingsUi.estimateHint') }}</p>
          <CollapsibleSettingsCard section-id="lyric-colors" :title="$t('mobile.settingsUi.lyricColors')" :subtitle="$t('mobile.settingsUi.lyricColorsHint')" :remember="false">
            <LyricColorPicker :settings="store.overlaySettings" @change="(key, value) => store.updateOverlayField(key, value)" @commit="store.flushLiveSettings()" />
          </CollapsibleSettingsCard>
          <div class="overlay-options">
            <label>{{ $t('mobile.settingsUi.fontSize') }} <b>{{ store.overlaySettings.fontSize }} sp</b></label>
            <ThumbRange class="settings-slider" min="16" max="34" :value="store.overlaySettings.fontSize" :aria-label="$t('mobile.settingsUi.fontSize')" @input="store.updateOverlayField('fontSize', Number(($event.target as HTMLInputElement).value))" @change="store.flushLiveSettings()" />
            <label class="settings-detail compact"><span>{{ $t('mobile.settingsUi.translation') }}</span><input type="checkbox" :checked="store.overlaySettings.translation" @change="store.updateOverlayField('translation', ($event.target as HTMLInputElement).checked)" /></label>
          <label class="settings-detail compact"><span>{{ $t('mobile.settingsUi.nextLine') }}</span><input type="checkbox" :checked="store.overlaySettings.nextLine" @change="store.updateOverlayField('nextLine', ($event.target as HTMLInputElement).checked)" /></label>
          <label class="settings-detail compact"><span>{{ $t('mobile.settingsUi.lockOverlay') }}</span><input type="checkbox" :checked="store.overlaySettings.locked" @change="store.updateOverlayField('locked', ($event.target as HTMLInputElement).checked)" /></label>
          <label class="settings-detail compact"><span>{{ $t('mobile.settingsUi.opaqueOverlay') }}</span><input type="checkbox" :checked="!store.overlaySettings.touchPassthroughPriority" :disabled="!store.overlaySettings.locked" @change="store.updateOverlayField('touchPassthroughPriority', !($event.target as HTMLInputElement).checked)" /></label>
          <p class="setting-note">{{ $t('mobile.settingsUi.opaqueHint') }}</p>
            <label class="settings-detail compact"><span>{{ $t('mobile.settingsUi.shadow') }}</span><input type="checkbox" :checked="store.overlaySettings.shadowEnabled" @change="store.updateOverlayField('shadowEnabled', ($event.target as HTMLInputElement).checked)" /></label>
          <label>{{ $t('mobile.settingsUi.shadowBlur') }} <b>{{ store.overlaySettings.shadowRadius }} dp</b></label>
          <ThumbRange class="settings-slider" min="0" max="8" :value="store.overlaySettings.shadowRadius" :aria-label="$t('mobile.settingsUi.shadowBlur')" @input="store.updateOverlayField('shadowRadius', Number(($event.target as HTMLInputElement).value))" @change="store.flushLiveSettings()" />
          <LyricOffsetControl :model-value="store.overlaySettings.currentLyricOffsetMs ?? 0" :track-key="[store.playback.trackId, store.playback.track?.localUri ?? '', store.playback.track?.localPath ?? '', store.playback.track?.neteaseId ?? ''].join('|')" :disabled="!store.playback.trackId" @update:model-value="store.updateCurrentLyricOffset" @commit="store.flushLiveSettings()" />
          </div>
        </CollapsibleSettingsCard>
</template>
