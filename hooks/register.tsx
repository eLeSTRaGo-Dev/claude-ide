import type { Register } from 'claude-code'

import { register as registerExplorer } from './explorer-panel'
import { register as registerGit } from './git-panel'

export const register: Register = on => {
  registerExplorer(on)
  registerGit(on)
}
