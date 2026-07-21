import api from '@/services/api'
import type { APIResponse, CategoryData } from '@/types'

export const categoryService = {
  list(): Promise<APIResponse<CategoryData>> {
    return api.get('/categories')
  },
}
