import type { Register } from 'claude-code'

import { register as registerExplorer } from './explorer'
import { register as registerGit } from './git'

export const register: Register = on => {
  registerExplorer(on)
  registerGit(on)
}
