import { createRouter, createWebHistory } from 'vue-router'
import Home from '@/views/Home.vue'
import Search from '@/views/Search.vue'
import Library from '@/views/Library.vue'
import Karaoke from '@/views/Karaoke.vue'
import Playlist from '@/views/Playlist.vue'
import Music from '@/views/Music.vue'

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