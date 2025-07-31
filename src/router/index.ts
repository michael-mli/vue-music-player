import { createRouter, createWebHistory } from 'vue-router'
import Home from '@/views/Home.vue'
import Search from '@/views/Search.vue'
import Library from '@/views/Library.vue'
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