import { useEffect, useState } from 'react';
import { getCurrentUserRole, isReviewerRole } from './reviewer-access';

export function useReviewerAccess(): { isReviewer: boolean; isLoading: boolean } {
  const [isReviewer, setIsReviewer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getCurrentUserRole()
      .then((role) => {
        if (active) {
          setIsReviewer(isReviewerRole(role));
        }
      })
      .catch(() => {
        if (active) {
          setIsReviewer(false);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return { isReviewer, isLoading };
}
