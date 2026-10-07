/** @jest-environment jsdom */
// A background read the role may not do must not log the user out (FMS GT 07.10: rfs was sent to
// /login?requireRole=admin from every folder page by the tasks widget's opted-out 403).
jest.mock('../../backend/utils/api', () => {
  class UnauthorizedError extends Error { status = 401 }
  class ForbiddenError extends Error { status = 403 }
  return {
    UnauthorizedError,
    ForbiddenError,
    redirectToSessionRefresh: jest.fn(),
    redirectToForbiddenLogin: jest.fn(),
    apiFetch: jest.fn(),
    setAuthRedirectConfig: jest.fn(),
  }
})
jest.mock('../../backend/FlashMessages', () => ({ flash: jest.fn() }))

import * as api from '../../backend/utils/api'
import { flash } from '../../backend/FlashMessages'
import { handleMutationAuthError, handleQueryAuthError } from '../QueryProvider'

const forbidden = Object.assign(new Error('Forbidden'), { status: 403 })
const expired = Object.assign(new Error('Unauthorized'), { status: 401 })

beforeEach(() => jest.clearAllMocks())
beforeAll(() => jest.spyOn(console, 'warn').mockImplementation(() => {}))

describe('query errors', () => {
  it('a 403 read does not redirect anywhere', () => {
    handleQueryAuthError(forbidden)
    handleQueryAuthError(new (api as any).ForbiddenError('x'))
    expect((api as any).redirectToForbiddenLogin).not.toHaveBeenCalled()
    expect((api as any).redirectToSessionRefresh).not.toHaveBeenCalled()
  })
  it('a 401 still refreshes the session', () => {
    handleQueryAuthError(expired)
    expect((api as any).redirectToSessionRefresh).toHaveBeenCalledTimes(1)
  })
  it('other errors are left alone', () => {
    handleQueryAuthError(new Error('boom'))
    expect((api as any).redirectToSessionRefresh).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
  })
})

describe('mutation errors', () => {
  it('a 403 action shows a message instead of logging out', () => {
    handleMutationAuthError(forbidden)
    expect(flash).toHaveBeenCalledWith(expect.any(String), 'error')
    expect((api as any).redirectToForbiddenLogin).not.toHaveBeenCalled()
  })
  it('a 401 still refreshes the session', () => {
    handleMutationAuthError(expired)
    expect((api as any).redirectToSessionRefresh).toHaveBeenCalledTimes(1)
  })
})
