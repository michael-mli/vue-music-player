import { createRouter, createWebHistory } from 'vue-router'
import Home from '@/views/Home.vue'
import Search from '@/views/Search.vue'
import Library from '@/views/Library.vue'
import DigSong from '@/views/DigSong.vue'
import Karaoke from '@/views/Karaoke.vue'
import Admin from '@/views/Admin.vue'
import Playlist from '@/views/Playlist.vue'
import Music from '@/views/Music.vue'
import PartyHome from '@/views/PartyHome.vue'
import PartyJoin from '@/views/PartyJoin.vue'
import PartyRoom from '@/views/PartyRoom.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: Home
    },
    {
      path: '/search',
      name: 'Search',
      component: Search
    },
    {
      path: '/dig',
      name: 'DigSong',
      component: DigSong
    },
    {
      path: '/library',
      name: 'Library',
      component: Library
    },
    {
      // Path is /sing (not /karaoke) to avoid colliding with the physical /karaoke/
      // instrumentals directory served at the web root. Route name stays "Karaoke".
      path: '/sing',
      name: 'Karaoke',
      component: Karaoke
    },
    { path: '/party', name: 'PartyHome', component: PartyHome },
    { path: '/party/join', name: 'PartyJoin', component: PartyJoin },
    { path: '/party/:roomId/stage', name: 'PartyStage', component: PartyRoom, props: { stage: true } },
    { path: '/party/:roomId', name: 'PartyRoom', component: PartyRoom },
    {
      path: '/admin',
      name: 'Admin',
      component: Admin
    },
    {
      path: '/playlist/:id',
      name: 'Playlist',
      component: Playlist,
      props: true
    },
    {
      path: '/music',
      name: 'Music',
      component: Music
    }
  ]
})

export default router
