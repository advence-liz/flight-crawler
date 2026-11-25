import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { getLoginOptions, getSiteAccount, SiteRequestError, type LoginOptions, type SiteAccount } from '@/api/site-auth';

type Session = { status: 'checking' | 'guest' | 'blocked' | 'unavailable' } | { status: 'member'; account: SiteAccount };

export function useSiteSession() {
  const [session, setSession] = useState<Session>({ status: 'checking' });
  const [options, setOptions] = useState<LoginOptions | null>();
  const revisions = useRef({ account: 0, options: 0 });
  const invalidate = useCallback(() => {
    revisions.current.account++;
    revisions.current.options++;
  }, []);
  const refresh = useCallback(async () => {
    const accountRequest = ++revisions.current.account;
    const optionRequest = ++revisions.current.options;
    setSession({ status: 'checking' });
    setOptions(undefined);
    await Promise.all([
      getLoginOptions().then(value => {
        if (optionRequest === revisions.current.options) setOptions(value?.github !== undefined ? value : null);
      }).catch(() => { if (optionRequest === revisions.current.options) setOptions(null); }),
      getSiteAccount().then(account => {
        if (accountRequest === revisions.current.account) setSession(account?.email ? { status: 'member', account } : { status: 'unavailable' });
      }).catch(error => {
        if (accountRequest !== revisions.current.account) return;
        const code = error instanceof SiteRequestError ? error.status : undefined;
        setSession({ status: code === 401 ? 'guest' : code === 403 ? 'blocked' : 'unavailable' });
      }),
    ]);
  }, []);
  useEffect(() => {
    void refresh();
    return invalidate;
  }, [invalidate, refresh]);

  const setHasToken = (hasToken: boolean) => setSession(current => current.status === 'member'
    ? { ...current, account: { ...current.account, hasToken } } : current);
  const clearSession = () => {
    revisions.current.account++;
    setSession({ status: 'guest' });
  };
  return { session, options, refresh, setHasToken, clearSession };
}

export function useAccountPage() {
  return useOutletContext<{ accountSession: ReturnType<typeof useSiteSession>; tripAgentEnabled: boolean }>();
}
