<template>
  <div class="party-room h-full overflow-y-auto p-5 sm:p-8" :class="stage ? 'bg-[#101820]' : ''">
    <div class="mx-auto" :class="stage ? 'max-w-6xl' : 'max-w-4xl'">
      <div v-if="loading && !party" class="text-gray-400">{{ $t('party.loading') }}</div>
      <div v-else-if="error && !party" role="alert" class="rounded-xl bg-red-500/10 p-5 text-red-300">
        {{ error }}
        <RouterLink to="/party" class="ml-3 underline">{{ $t('party.back') }}</RouterLink>
      </div>
      <template v-else-if="party">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <RouterLink v-if="!stage" to="/party" class="text-sm text-spotify-green">← {{ $t('party.back') }}</RouterLink>
            <h1 class="mt-1 text-2xl font-bold sm:text-3xl">{{ party.room.name }}</h1>
          </div>
          <div class="flex flex-wrap gap-2">
            <RouterLink v-if="!stage && party.self.admission === 'admitted'" :to="`/party/${roomId}/stage`"
              class="rounded-full border border-white/25 px-4 py-2 text-sm hover:bg-white/10">
              {{ $t('party.openStage') }}
            </RouterLink>
            <RouterLink v-if="stage && party.deviceScope !== 'display'" :to="`/party/${roomId}`" class="rounded-full border border-white/25 px-4 py-2 text-sm hover:bg-white/10">
              {{ $t('party.openControls') }}
            </RouterLink>
          </div>
        </header>
        <p class="mt-2 text-xs" :class="liveConnected ? 'text-spotify-green' : 'text-gray-400'" role="status">
          {{ liveConnected ? $t('party.liveConnected') : $t('party.reconnecting') }}
        </p>
        <details v-if="party.self.admission === 'admitted'" class="mt-2 text-xs text-gray-400">
          <summary class="cursor-pointer">{{ $t('party.connectionDetails') }}</summary>
          <p class="mt-2" role="status">{{ !liveConnected ? $t('party.clockOffline') : clockEstimate?.status === 'healthy' ? $t('party.clockHealthy') : clockEstimate?.status === 'uncertain' || clockEstimate?.status === 'stale' ? $t('party.clockUncertain') : $t('party.clockCollecting') }}</p>
          <p v-if="clockEstimate" class="mt-1">{{ $t('party.clockMetrics', { delay: Math.round(clockEstimate.roundTripMs), uncertainty: Math.ceil(clockEstimate.uncertaintyMs) }) }}</p>
          <p class="mt-1">{{ $t('party.clockHint') }}</p>
        </details>

        <p v-if="error" role="alert" class="mt-5 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{{ error }}</p>
        <div v-if="party.self.admission === 'pending'" class="mt-8 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-8 text-center">
          <h2 class="text-xl font-semibold">{{ $t('party.waitingTitle') }}</h2>
          <p class="mt-2 text-sm text-gray-300">{{ $t('party.waitingHint') }}</p>
          <p class="mt-4 text-xs text-gray-400">{{ $t('party.refreshesAutomatically') }}</p>
        </div>
        <div v-else-if="party.self.admission === 'rejected'" class="mt-8 rounded-2xl border border-red-500/20 bg-red-500/10 p-8 text-center">
          <h2 class="text-xl font-semibold">{{ $t('party.rejectedTitle') }}</h2>
          <p class="mt-2 text-sm text-gray-300">{{ $t('party.rejectedHint') }}</p>
          <RouterLink to="/party" class="mt-5 inline-block text-sm text-spotify-green underline">{{ $t('party.back') }}</RouterLink>
        </div>

        <nav v-if="party.self.admission === 'admitted' && !stage" class="sticky top-0 z-10 mt-5 rounded-2xl border border-white/15 bg-[#121c20] p-1" :aria-label="$t('party.controllerTabs')">
          <div role="tablist" class="grid grid-cols-4 gap-1" :aria-label="$t('party.controllerTabs')">
            <button v-for="tab in tabs" :id="`party-tab-${tab}`" :key="tab" type="button" role="tab"
              :aria-selected="activeTab === tab" :aria-controls="`party-panel-${tab}`" :tabindex="activeTab === tab ? 0 : -1"
              class="min-h-[48px] rounded-xl px-2 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
              :class="activeTab === tab ? 'bg-spotify-green text-black' : 'text-gray-300 hover:bg-white/10'"
              @click="selectTab(tab)" @keydown="tabKeydown($event, tab)">
              {{ $t(`party.tab${tab[0].toUpperCase()}${tab.slice(1)}`) }}
              <span v-if="tab === 'queue' && party.queue?.length" class="ml-1">({{ party.queue.length }})</span>
              <span v-if="tab === 'people' && pendingMembers.length" class="ml-1 text-xs">({{ pendingMembers.length }})</span>
            </button>
          </div>
        </nav>
        <div v-if="!stage && party.readiness?.state === 'awaiting-singer' && party.readiness.singerMemberId === party.self.id && activeTab !== 'sing'"
          role="status" class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300/30 bg-emerald-950/30 p-4">
          <p class="text-sm">{{ $t('party.yourTurn', { title: party.readiness.title }) }}</p>
          <button type="button" class="rounded-full bg-spotify-green px-4 py-2 text-sm font-semibold text-black" @click="selectTab('sing', true)">{{ $t('party.openSing') }}</button>
        </div>

        <div v-if="party.self.admission === 'admitted'" id="party-panel-sing" v-show="stage || activeTab === 'sing'"
          :role="stage ? undefined : 'tabpanel'" :aria-labelledby="stage ? undefined : 'party-tab-sing'" :tabindex="stage ? undefined : 0">
          <PartyPlaybackPanel :party="party" :audio="roomAudio" :stage="stage" :can-manage="isModerator" :busy="busy"
            @prepare="preparePlayback" @action="playbackAction" />
              <section v-if="!stage && party.readiness?.entryId" class="rounded-2xl border border-spotify-green/30 bg-emerald-900/10 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.singerInvitation') }}</h2>
                <p class="mt-3 text-xl font-semibold">{{ party.readiness.title }}</p>
                <p class="mt-1 text-sm text-gray-300">{{ $t('party.singer') }}: {{ party.readiness.singerName }}</p>
                <p class="mt-3 text-sm text-spotify-green" role="status">{{ party.readiness.state === 'ready' ? $t('party.singerReady') : $t('party.awaitingSinger') }}</p>
                <p class="mt-2 text-xs text-gray-400">{{ $t('party.readinessHint') }}</p>
                <div class="mt-4 flex flex-wrap gap-3">
                  <template v-if="party.readiness.singerMemberId === party.self.id && party.readiness.state === 'awaiting-singer'">
                    <button type="button" :disabled="busy" class="rounded-full bg-spotify-green px-4 py-2 text-sm font-semibold text-black disabled:opacity-50" @click="respondReady(true)">{{ $t('party.confirmReady') }}</button>
                    <button type="button" :disabled="busy" class="rounded-full border border-white/25 px-4 py-2 text-sm disabled:opacity-50" @click="respondReady(false)">{{ $t('party.declineTurn') }}</button>
                  </template>
                  <button v-if="isModerator" type="button" :disabled="busy" class="text-sm text-gray-300 underline disabled:opacity-50" @click="cancelReadiness">{{ $t('party.cancelInvitation') }}</button>
                </div>
              </section>
        </div>

        <template v-if="party.self.admission === 'admitted' && stage">
          <aside v-if="stageInvitationLink" class="mt-5 flex flex-wrap items-center justify-center gap-5 rounded-2xl border border-white/15 p-5" :aria-label="$t('party.invitePeople')">
            <PartyQrCode :value="stageInvitationLink" :label="$t('party.invitationQr')" />
            <div><p class="text-lg">{{ $t('party.invitationCode') }}</p><code class="mt-2 block text-3xl tracking-widest">{{ party.stageInvitationCode }}</code></div>
          </aside>
          <div v-if="!party.playback || party.playback.state === 'idle'" class="mt-8 flex min-h-[50vh] flex-col items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-b from-emerald-900/30 to-black/30 px-6 text-center">
            <p class="text-sm uppercase tracking-[0.25em] text-spotify-green">{{ $t('party.stage') }}</p>
            <h2 class="mt-5 text-3xl font-bold sm:text-5xl">{{ party.readiness?.entryId ? party.readiness.title : $t('party.stageReady') }}</h2>
            <template v-if="party.readiness?.entryId">
              <p class="mt-3 text-xl">{{ party.readiness.singerName }}</p>
              <p class="mt-3 text-spotify-green">{{ party.readiness.state === 'ready' ? $t('party.singerReady') : $t('party.awaitingSinger') }}</p>
            </template>
            <p class="mt-4 max-w-xl text-gray-300">{{ $t('party.stageWaiting') }}</p>

          </div>
            <div v-if="party.queue?.length" class="mt-8 w-full max-w-xl text-left">
              <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-spotify-green">{{ $t('party.upNext') }}</h3>
              <ol class="space-y-2">
                <li v-for="(entry, index) in party.queue.slice(0, 5)" :key="entry.id" class="rounded-xl bg-white/10 px-4 py-3">
                  <span class="font-semibold">{{ index + 1 }}. {{ entry.title }}</span>
                  <span class="ml-2 text-sm text-gray-300">{{ entry.singerName }}</span>
                  <span v-if="entry.state === 'held'" class="ml-2 text-xs text-yellow-300">{{ $t('party.held') }}</span>
                  <span v-else-if="!entry.singerAccepted" class="ml-2 text-xs text-yellow-300">{{ $t('party.awaitingAcceptance') }}</span>
                </li>
              </ol>
            </div>
          <div class="mt-5 flex flex-wrap gap-3 text-sm text-gray-300">
            <span>{{ $t('party.peopleCount', { count: admittedMembers.length }) }}</span>
            <span v-for="member in admittedMembers" :key="member.id">{{ member.displayName }}</span>
          </div>
        </template>

        <template v-else-if="party.self.admission === 'admitted'">
          <div class="mt-6 space-y-5">
              <section id="party-panel-songs" v-show="activeTab === 'songs'" role="tabpanel" aria-labelledby="party-tab-songs" tabindex="0" class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.tabSongs') }}</h2>
                <p class="mt-2 text-sm text-gray-400">{{ $t('party.queuePlanning') }}</p>
                <label class="mt-4 block text-sm font-medium" for="party-song-singer">{{ $t('party.chooseSinger') }}</label>
                <select id="party-song-singer" v-model="selectedSingerId" class="mt-2 w-full rounded-lg border border-white/20 bg-[#182020] px-3 py-2">
                  <option v-for="member in admittedMembers" :key="member.id" :value="member.id">{{ memberLabel(member) }}{{ member.id === party.self.id ? ` (${$t('party.you')})` : '' }}</option>
                </select>
                <p class="mt-2 text-xs text-gray-400">{{ $t('party.nominationHint') }}</p>
                <p v-if="party.limits" class="mt-2 text-sm" :class="singerQueueFull ? 'text-amber-200' : 'text-gray-300'" role="status">{{ $t('party.singerQueueLimit', { count: singerRequestCount, max: party.limits.singerRequests }) }}</p>
                <label class="mt-5 block text-sm font-medium" for="party-song-search">{{ $t('party.searchSongs') }}</label>
                <input id="party-song-search" v-model="songSearch" type="search" :placeholder="$t('party.searchSongs')"
                  class="mt-2 w-full rounded-lg border border-white/20 bg-black/20 px-3 py-2 outline-none focus:border-spotify-green" />
                <p v-if="catalogLoading" class="mt-3 text-sm text-gray-400">{{ $t('party.loadingSongs') }}</p>
                <p v-else-if="!karaokeService.count" class="mt-3 text-sm text-gray-400">{{ $t('party.noKaraokeSongs') }}</p>
                <ul v-else class="mt-3 max-h-72 space-y-2 overflow-y-auto">
                  <li v-for="song in matchingSongs" :key="song.id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/20 p-3">
                    <span class="min-w-0 flex-1 truncate text-sm">{{ song.title }}</span>
                    <div class="flex gap-2 text-xs">
                      <button type="button" :disabled="busy || singerQueueFull" class="rounded-full border border-white/25 px-3 py-1.5 hover:bg-white/10 disabled:opacity-50" @click="requestSong(song, false)">{{ $t('party.addSong') }}</button>
                      <button type="button" :disabled="busy || singerQueueFull" class="rounded-full border border-spotify-green px-3 py-1.5 text-spotify-green hover:bg-white/10 disabled:opacity-50" @click="requestSong(song, true)">{{ $t('party.requestNext') }}</button>
                    </div>
                  </li>
                </ul>
                <p v-if="!catalogLoading && karaokeService.count && !matchingSongs.length" class="mt-3 text-sm text-gray-400">{{ $t('party.noMatchingSongs') }}</p>
              </section>
              <section id="party-panel-queue" v-show="activeTab === 'queue'" role="tabpanel" aria-labelledby="party-tab-queue" tabindex="0" class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.upcomingQueue') }}</h2>
                <p v-if="!party.queue?.length" class="mt-2 text-sm text-gray-400">{{ $t('party.emptyQueue') }}</p>
                <ol v-else class="mt-3 space-y-2">
                  <li v-for="(entry, index) in party.queue" :key="entry.id" class="rounded-lg bg-black/20 p-3">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="font-medium">{{ index + 1 }}. {{ entry.title }}</p>
                        <p class="mt-1 text-xs text-gray-400">{{ $t('party.singer') }}: {{ entry.singerName }} · {{ $t('party.requestedBy') }}: {{ entry.requesterName }}</p>
                        <p v-if="entry.state === 'held'" class="mt-1 text-xs text-yellow-300">{{ $t('party.held') }}</p>
                        <p v-else-if="!entry.singerAccepted" class="mt-1 text-xs text-yellow-300">{{ $t('party.awaitingAcceptance') }}</p>
                        <p v-else-if="entry.priorityApproved" class="mt-1 text-xs text-spotify-green">{{ $t('party.nextApproved') }}</p>
                        <p v-else-if="entry.priorityRequested" class="mt-1 text-xs text-yellow-300">{{ $t('party.nextPending') }}</p>
                        <p v-if="party.readiness?.entryId === entry.id" class="mt-1 text-xs text-spotify-green">{{ $t('party.selectedTurn') }}</p>
                      </div>
                      <div class="flex shrink-0 flex-col items-end gap-2 text-xs">
                        <template v-if="entry.state === 'queued' && entry.singerMemberId === party.self.id && entry.requesterMemberId !== party.self.id && canEditRequest(entry.id)">
                          <button v-if="!entry.singerAccepted" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="acceptSong(entry.id)">{{ $t('party.acceptNomination') }}</button>
                          <button type="button" :disabled="busy" class="text-gray-300 disabled:opacity-50" @click="declineSong(entry.id)">{{ $t('party.declineNomination') }}</button>
                        </template>
                        <button v-if="isModerator && entry.state === 'queued' && entry.singerAccepted && party.readiness?.entryId !== entry.id" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="offerSinger(entry.id)">{{ $t('party.inviteSinger') }}</button>
                        <button v-if="isModerator && entry.priorityRequested && !entry.priorityApproved && entry.state === 'queued' && canEditRequest(entry.id)" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="approveNext(entry.id)">{{ $t('party.approveNext') }}</button>
                        <button v-if="(isModerator || entry.requesterMemberId === party.self.id) && canEditRequest(entry.id)" type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="cancelSong(entry.id)">{{ $t('party.removeSong') }}</button>
                      </div>
                    </div>
                  </li>
                </ol>
              </section>
            <div id="party-panel-people" v-show="activeTab === 'people'" role="tabpanel" aria-labelledby="party-tab-people" tabindex="0" class="space-y-5">
              <section v-if="isHost" class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.invitePeople') }}</h2>
                <p class="mt-2 text-sm text-gray-400">{{ $t('party.inviteHint') }}</p>
                <div class="mt-4 flex flex-wrap items-center gap-3">
                  <code class="rounded-lg bg-black/30 px-4 py-2 text-xl tracking-widest">{{ party.invitationCode }}</code>
                  <button type="button" class="rounded-full border border-white/25 px-4 py-2 text-sm hover:bg-white/10" @click="copyLink">
                    {{ $t('party.copyInvite') }}
                  </button>
                  <button type="button" :disabled="busy" class="text-sm text-gray-300 underline disabled:opacity-50" @click="rotateCode">
                    {{ $t('party.rotateCode') }}
                  </button>
                </div>
                <PartyQrCode v-if="invitationLink" :value="invitationLink" :label="$t('party.invitationQr')" />
                <a :href="invitationLink" class="mt-3 block break-all text-sm text-spotify-green underline">{{ $t('party.openInvitation') }}</a>
                <p v-if="copied" role="status" class="mt-2 text-sm text-spotify-green">{{ $t('party.linkCopied') }}</p>
              </section>
              <section v-if="!party.deviceScope && party.self.admission === 'admitted'" class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.pairDevice') }}</h2>
                <p class="mt-2 text-sm text-gray-400">{{ $t('party.pairHint') }}</p>
                <fieldset class="mt-4 flex flex-wrap gap-4 text-sm">
                  <legend class="mb-2 font-medium">{{ $t('party.deviceAccess') }}</legend>
                  <label class="flex items-center gap-2"><input v-model="pairScope" type="radio" value="display" class="accent-green-500" />{{ $t('party.displayScope') }}</label>
                  <label class="flex items-center gap-2"><input v-model="pairScope" type="radio" value="controller" class="accent-green-500" />{{ $t('party.controllerScope') }}</label>
                </fieldset>
                <p class="mt-2 text-xs text-gray-400">{{ pairScope === 'display' ? $t('party.displayScopeHint') : $t('party.controllerScopeHint') }}</p>
                <button type="button" :disabled="pairBusy" class="mt-4 rounded-full border border-spotify-green px-4 py-2 text-sm text-spotify-green disabled:opacity-50" @click="createPairing">
                  {{ pairBusy ? $t('party.working') : $t('party.createPairing') }}
                </button>
                <div v-if="pairing" class="mt-4 rounded-xl bg-black/30 p-4" role="status">
                  <p class="text-sm text-gray-300">{{ $t('party.enterPairCode') }}</p>
                  <code class="mt-2 block text-2xl tracking-widest">{{ pairing.code }}</code>
                  <p class="mt-2 text-xs text-gray-400">{{ $t('party.pairExpires', { time: formatTime(pairing.expiresAt) }) }}</p>
                  <p class="mt-2 text-xs text-gray-400">{{ $t('party.pairSingleUse') }}</p>
                  <PartyQrCode :value="pairingLink" :label="$t('party.pairingQr')" />
                  <a :href="pairingLink" class="mt-3 block text-sm text-spotify-green underline">{{ $t('party.openPairing') }}</a>
                </div>
                <h3 class="mt-6 font-semibold">{{ $t('party.pairedDevices') }}</h3>
                <p v-if="!pairedDevices.length" class="mt-2 text-sm text-gray-400">{{ $t('party.noPairedDevices') }}</p>
                <ul v-else class="mt-3 space-y-2">
                  <li v-for="device in pairedDevices" :key="device.id" class="flex items-center justify-between gap-3 rounded-lg bg-black/20 p-3 text-sm">
                    <span>{{ device.scope === 'display' ? $t('party.displayScope') : $t('party.controllerScope') }} · {{ formatTime(device.createdAt) }}</span>
                    <button type="button" :disabled="pairBusy" class="text-red-300 disabled:opacity-50" @click="revokeDevice(device.id)">{{ $t('party.revokeDevice') }}</button>
                  </li>
                </ul>
              </section>
              <section v-if="isModerator" class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.roomControls') }}</h2>
                <label class="mt-4 flex items-center gap-3 text-sm">
                  <input type="checkbox" :checked="party.room.approvalRequired" :disabled="busy"
                    class="accent-green-500" @change="changeSetting({ approvalRequired: !party?.room.approvalRequired })" />
                  {{ $t('party.requireApproval') }}
                </label>
                <label class="mt-4 flex items-center gap-3 text-sm">
                  <input type="checkbox" :checked="party.room.locked" :disabled="busy"
                    class="accent-green-500" @change="changeSetting({ locked: !party?.room.locked })" />
                  {{ $t('party.lockRoom') }}
                </label>
                <label v-if="isHost" class="mt-4 flex min-h-[44px] items-center gap-3 text-sm">
                  <input type="checkbox" :checked="party.room.stageInviteVisible" :disabled="busy" class="accent-green-500"
                    @change="changeSetting({ stageInviteVisible: !party?.room.stageInviteVisible })" />
                  {{ $t('party.showStageInvitation') }}
                </label>
                <button v-if="isHost" type="button" :disabled="busy" class="mt-6 text-sm text-red-300 underline disabled:opacity-50" @click="closeRoom">
                  {{ $t('party.closeRoom') }}
                </button>
              </section>
            <section class="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 class="text-lg font-semibold">{{ $t('party.people') }}</h2>
              <p class="mt-1 text-sm text-gray-400">{{ $t('party.peopleCount', { count: admittedMembers.length }) }}</p>
              <ul class="mt-4 space-y-3">
                <li v-for="member in party.members" :key="member.id" class="rounded-lg bg-black/20 p-3">
                  <div class="flex items-center justify-between gap-2">
                    <span class="min-w-0 truncate">{{ member.displayName }}<span v-if="duplicateNames.has(member.displayName)" class="ml-1 text-xs text-gray-400">#{{ member.id.slice(0, 6) }}</span></span>
                    <span class="text-xs text-gray-400">{{ member.admission === 'pending' ? $t('party.waiting') : member.role === 'host' ? $t('party.host') : member.role === 'cohost' ? $t('party.cohost') : '' }}</span>
                  </div>
                  <div v-if="canModerateMember(member)" class="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-sm">
                    <button v-if="member.admission === 'pending'" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="approve(member.id)">
                      {{ $t('party.approve') }}
                    </button>
                    <button v-if="member.admission === 'pending'" type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="reject(member)">
                      {{ $t('party.reject') }}
                    </button>
                    <button v-else type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="remove(member.id)">
                      {{ $t('party.remove') }}
                    </button>
                    <button type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="block(member)">{{ $t('party.block') }}</button>
                  </div>
                  <div v-if="isHost && member.role !== 'host' && member.admission === 'admitted'" class="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-sm">
                    <button type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="changeRole(member)">
                      {{ member.role === 'cohost' ? $t('party.removeCohost') : $t('party.makeCohost') }}
                    </button>
                    <button type="button" :disabled="busy" class="text-gray-300 disabled:opacity-50" @click="transferHost(member)">{{ $t('party.transferHost') }}</button>
                  </div>
                </li>
              </ul>
              <template v-if="isModerator && party.excludedMembers?.length">
                <h3 class="mt-6 font-semibold">{{ $t('party.excludedPeople') }}</h3>
                <p class="mt-2 text-xs text-gray-400">{{ $t('party.restoreHint') }}</p>
                <ul class="mt-3 space-y-3">
                  <li v-for="member in party.excludedMembers" :key="member.id" class="rounded-lg bg-black/20 p-3">
                    <p class="truncate">{{ member.displayName }}<span v-if="duplicateNames.has(member.displayName)" class="ml-1 text-xs text-gray-400">#{{ member.id.slice(0, 6) }}</span></p>
                    <p class="mt-1 text-xs text-gray-400">{{ member.blocked ? $t('party.blocked') : member.admission === 'rejected' ? $t('party.rejected') : $t('party.removed') }}</p>
                    <div class="mt-2 flex flex-wrap gap-3 text-sm">
                      <button v-if="member.blocked" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="unblock(member)">{{ $t('party.unblock') }}</button>
                      <button v-else type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="approve(member.id)">{{ $t('party.restoreMember') }}</button>
                      <button v-if="!member.blocked" type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="block(member)">{{ $t('party.block') }}</button>
                    </div>
                  </li>
                </ul>
              </template>
            </section>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { partyApi, type PartyDeviceSummary, type PartyMember, type PartyPairing, type PartySnapshot, type PartyTurnCommand } from '@/services/partyApi'
import { subscribeParty } from '@/services/partyRealtime'
import type { PartySubscription } from '@/services/partyRealtime'
import { usePartyPlayback } from '@/composables/usePartyPlayback'
import PartyPlaybackPanel from '@/components/Party/PartyPlaybackPanel.vue'
import PartyQrCode from '@/components/Party/PartyQrCode.vue'
import { useSongsStore } from '@/stores/songs'
import { karaokeService } from '@/services/karaokeService'
import type { Song } from '@/types'
import type { PartyClockEstimate } from '@/utils/partyClock'

const props = withDefaults(defineProps<{ stage?: boolean }>(), { stage: false })
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const roomId = computed(() => String(route.params.roomId))
const tabs = ['songs', 'queue', 'sing', 'people'] as const
type ControllerTab = typeof tabs[number]
const activeTab = ref<ControllerTab>('songs')
function selectTab(tab: ControllerTab, focusPanel = false) {
  activeTab.value = tab
  if (focusPanel) void nextTick(() => document.getElementById(`party-panel-${tab}`)?.focus())
}
function tabKeydown(event: KeyboardEvent, tab: ControllerTab) {
  const index = tabs.indexOf(tab)
  const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] :
    event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : null
  if (!target) return
  event.preventDefault(); selectTab(target)
  void nextTick(() => document.getElementById(`party-tab-${target}`)?.focus())
}
const party = ref<PartySnapshot | null>(null)
const loading = ref(true)
const busy = ref(false)
const copied = ref(false)
const error = ref('')
const liveConnected = ref(false)
const clockEstimate = ref<PartyClockEstimate | null>(null)
const selectedSingerId = ref('')
const singerRequestCount = computed(() => party.value?.queue?.filter(entry => entry.singerMemberId === selectedSingerId.value).length || 0)
const singerQueueFull = computed(() => !!party.value?.limits && singerRequestCount.value >= party.value.limits.singerRequests)
const isHost = computed(() => party.value?.self.admission === 'admitted' && party.value.self.role === 'host' && party.value.deviceScope !== 'display')
const isModerator = computed(() => party.value?.self.admission === 'admitted' &&
  ['host', 'cohost'].includes(party.value.self.role) && party.value.deviceScope !== 'display')
const pendingMembers = computed(() => party.value?.members?.filter(member => member.admission === 'pending') || [])
const invitationLink = computed(() => party.value?.invitationCode ? `${window.location.origin}/party/join#invite=${party.value.invitationCode}` : '')
const stageInvitationLink = computed(() => party.value?.stageInvitationCode ? `${window.location.origin}/party/join#invite=${party.value.stageInvitationCode}` : '')
const pairingLink = computed(() => pairing.value ? `${window.location.origin}/party/pair#pair=${pairing.value.code}` : '')
const admittedMembers = computed(() => party.value?.members?.filter(member => member.admission === 'admitted') || [])
const duplicateNames = computed(() => {
  const counts = new Map<string, number>()
  for (const member of [...(party.value?.members || []), ...(party.value?.excludedMembers || [])]) {
    counts.set(member.displayName, (counts.get(member.displayName) || 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name))
})
const pairScope = ref<'display' | 'controller'>('display')
const pairing = ref<PartyPairing | null>(null)
const pairedDevices = ref<PartyDeviceSummary[]>([])
const pairBusy = ref(false)
const songsStore = useSongsStore()
const songSearch = ref('')
const catalogLoading = ref(false)
const matchingSongs = computed(() => {
  const query = songSearch.value.trim().toLocaleLowerCase()
  if (!query) return songsStore.songs.filter(song => karaokeService.isAvailable(song.id)).slice(0, 30)
  return songsStore.songs.filter(song => karaokeService.isAvailable(song.id) &&
    `${song.title} ${song.artist || ''} ${song.id}`.toLocaleLowerCase().includes(query)).slice(0, 30)
})
let timer: number | undefined
let pairExpireTimer: number | undefined
let stopRealtime: PartySubscription | undefined
const roomAudio = usePartyPlayback(party, liveConnected, clockEstimate, message => stopRealtime?.send(message) || false)
let realtimeEnded = false

function applySnapshot(next: PartySnapshot) {
  if (next.room.id !== roomId.value) return
  if (!party.value || next.room.revision >= party.value.room.revision) party.value = next
  if (!party.value?.members?.some(member => member.id === selectedSingerId.value && member.admission === 'admitted')) {
    selectedSingerId.value = party.value?.self.id || ''
  }
  if (next.deviceScope === 'display' && !props.stage) void router.replace(`/party/${roomId.value}/stage`)
  if (!props.stage && !next.deviceScope && next.self.admission === 'admitted') void loadDevices()
}

function formatTime(value: string) { return new Date(value).toLocaleString() }

async function loadDevices() {
  if (party.value?.deviceScope || party.value?.self.admission !== 'admitted') return
  try { pairedDevices.value = await partyApi.devices(roomId.value) }
  catch (reason) { error.value = String((reason as Error).message) }
}

async function createPairing() {
  if (pairBusy.value) return
  pairBusy.value = true
  error.value = ''
  pairing.value = null
  try {
    pairing.value = await partyApi.createPairing(roomId.value, pairScope.value)
    if (pairExpireTimer !== undefined) window.clearTimeout(pairExpireTimer)
    pairExpireTimer = window.setTimeout(() => { pairing.value = null },
      Math.max(0, Date.parse(pairing.value.expiresAt) - Date.now()))
  }
  catch (reason) { error.value = String((reason as Error).message) }
  finally { pairBusy.value = false }
}

async function revokeDevice(deviceId: string) {
  if (pairBusy.value || !window.confirm(t('party.confirmRevokeDevice'))) return
  pairBusy.value = true
  error.value = ''
  try { await partyApi.revokeDevice(roomId.value, deviceId); await loadDevices() }
  catch (reason) { error.value = String((reason as Error).message) }
  finally { pairBusy.value = false }
}

function startRealtime() {
  stopRealtime?.()
  realtimeEnded = false
  stopRealtime = subscribeParty(roomId.value, applySnapshot,
    (connected) => { liveConnected.value = connected },
    () => { realtimeEnded = true; void refresh() },
    (estimate) => { clockEstimate.value = estimate },
    { deviceId: roomAudio.deviceId, onMessage: roomAudio.message })
}

async function loadCatalog() {
  catalogLoading.value = true
  try {
    await Promise.all([songsStore.songs.length ? Promise.resolve() : songsStore.fetchSongs(), karaokeService.ensureLoaded()])
  } finally { catalogLoading.value = false }
}

async function refresh() {
  const requestedRoom = roomId.value
  try {
    const next = await partyApi.get(requestedRoom)
    if (requestedRoom !== roomId.value) return
    applySnapshot(next)
    error.value = ''
    // A moderator may restore a rejected/removed member while HTTP polling is
    // active. Reacquire a ticket only after a successful authorized snapshot.
    if (realtimeEnded) startRealtime()
  } catch (reason) {
    if (requestedRoom !== roomId.value) return
    party.value = null
    error.value = String((reason as Error).message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
  startRealtime()
  if (!props.stage) void loadCatalog()
  timer = window.setInterval(() => { if (!document.hidden && !busy.value && !liveConnected.value) void refresh() }, 3000)
})
onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer)
  if (pairExpireTimer !== undefined) window.clearTimeout(pairExpireTimer)
  stopRealtime?.()
})
watch(roomId, () => {
  party.value = null; pairing.value = null; pairedDevices.value = []; activeTab.value = 'songs'
  if (pairExpireTimer !== undefined) window.clearTimeout(pairExpireTimer)
  loading.value = true; void refresh(); startRealtime()
})
watch(() => props.stage, (stage) => { if (!stage) void loadCatalog() })

async function act(work: () => Promise<PartySnapshot>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { applySnapshot(await work()) }
  catch (reason) {
    const message = String((reason as Error).message)
    await refresh()
    error.value = message
  }
  finally { busy.value = false }
}

function canModerateMember(member: PartyMember) {
  return isModerator.value && member.id !== party.value?.self.id && member.role !== 'host' &&
    (isHost.value || member.role !== 'cohost')
}
function canEditRequest(entryId: string) {
  return party.value?.playback?.entryId !== entryId || party.value.playback.state === 'idle'
}
function memberLabel(member: PartyMember) {
  return duplicateNames.value.has(member.displayName) ? `${member.displayName} #${member.id.slice(0, 6)}` : member.displayName
}
function approve(memberId: string) { void act(() => partyApi.approve(roomId.value, memberId, crypto.randomUUID())) }
function remove(memberId: string) {
  if (window.confirm(t('party.confirmRemove'))) void act(() => partyApi.remove(roomId.value, memberId, crypto.randomUUID()))
}
function reject(member: PartyMember) {
  if (window.confirm(t('party.confirmReject', { name: memberLabel(member) }))) {
    void act(() => partyApi.reject(roomId.value, member.id, crypto.randomUUID()))
  }
}
function block(member: PartyMember) {
  if (window.confirm(t('party.confirmBlock', { name: memberLabel(member) }))) {
    void act(() => partyApi.block(roomId.value, member.id, crypto.randomUUID()))
  }
}
function unblock(member: PartyMember) {
  if (window.confirm(t('party.confirmUnblock', { name: memberLabel(member) }))) {
    void act(() => partyApi.unblock(roomId.value, member.id, crypto.randomUUID()))
  }
}
function changeRole(member: PartyMember) {
  const role = member.role === 'cohost' ? 'member' : 'cohost'
  if (window.confirm(t(role === 'cohost' ? 'party.confirmMakeCohost' : 'party.confirmRemoveCohost', { name: memberLabel(member) }))) {
    void act(() => partyApi.role(roomId.value, member.id, role, crypto.randomUUID()))
  }
}
function transferHost(member: PartyMember) {
  if (window.confirm(t('party.confirmTransferHost', { name: memberLabel(member) }))) {
    void act(() => partyApi.transferHost(roomId.value, member.id, crypto.randomUUID()))
  }
}
function rotateCode() { void act(() => partyApi.rotate(roomId.value)) }
function requestSong(song: Song, requestNext: boolean) {
  void act(() => partyApi.requestSong(roomId.value, song.id, song.title, requestNext, crypto.randomUUID(), selectedSingerId.value))
}
function acceptSong(entryId: string) { void act(() => partyApi.acceptSong(roomId.value, entryId, crypto.randomUUID())) }
function declineSong(entryId: string) {
  if (window.confirm(t('party.confirmDeclineNomination'))) void act(() => partyApi.declineSong(roomId.value, entryId, crypto.randomUUID()))
}
function offerSinger(entryId: string) {
  if (!party.value || (party.value.readiness?.entryId && !window.confirm(t('party.confirmReplaceInvitation')))) return
  void act(() => partyApi.offerSinger(roomId.value, entryId, crypto.randomUUID(), party.value!.clock.clockId, party.value!.room.revision))
}
function turnCommand(): PartyTurnCommand | null {
  const current = party.value?.readiness
  if (!party.value || !current?.performanceId) return null
  return { commandId: crypto.randomUUID(), clockId: current.clockId, baseRevision: party.value.room.revision,
    performanceId: current.performanceId, generation: current.generation }
}
function respondReady(ready: boolean) {
  if (!ready && !window.confirm(t('party.confirmDeclineTurn'))) return
  const command = turnCommand()
  if (command) void act(() => partyApi.respondReady(roomId.value, command, ready))
}
function cancelReadiness() {
  const command = turnCommand()
  if (command && window.confirm(t('party.confirmCancelInvitation'))) void act(() => partyApi.cancelReadiness(roomId.value, command))
}
function preparePlayback() {
  const command = turnCommand()
  if (command) void act(() => partyApi.preparePlayback(roomId.value, command))
}
function playbackAction(action: string, payload: Record<string, unknown>) {
  if (!party.value) return
  const current = party.value.playback
  const command = { commandId: crypto.randomUUID(), clockId: party.value.clock.clockId, baseRevision: party.value.room.revision,
    performanceId: current?.performanceId, generation: current?.generation, ...payload }
  void act(() => partyApi.playbackCommand(roomId.value, action, command))
}
function cancelSong(entryId: string) {
  void act(() => partyApi.cancelSong(roomId.value, entryId, crypto.randomUUID()))
}
function approveNext(entryId: string) {
  void act(() => partyApi.approveNext(roomId.value, entryId, crypto.randomUUID()))
}
function changeSetting(changes: { locked?: boolean; approvalRequired?: boolean; stageInviteVisible?: boolean }) {
  void act(() => partyApi.settings(roomId.value, changes))
}
async function closeRoom() {
  if (!window.confirm(t('party.confirmClose')) || busy.value) return
  busy.value = true
  try { await partyApi.close(roomId.value); await router.push('/party') }
  catch (reason) { error.value = String((reason as Error).message); busy.value = false }
}
async function copyLink() {
  if (!party.value?.invitationCode) return
  const link = invitationLink.value
  try { await navigator.clipboard.writeText(link); copied.value = true }
  catch { error.value = t('party.copyFailed') }
}
</script>

<style scoped>
.party-room button, .party-room select, .party-room input:not([type='checkbox']):not([type='radio']) {
  min-height: 44px;
}
.party-room button:focus-visible, [role='tabpanel']:focus-visible {
  outline: 2px solid #6ee7b7;
  outline-offset: 3px;
}
</style>
