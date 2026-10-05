import type { Register } from 'claude-code'

import { register as registerExplorer } from './explorer'

export const register: Register = on => {
  registerExplorer(on)
}
