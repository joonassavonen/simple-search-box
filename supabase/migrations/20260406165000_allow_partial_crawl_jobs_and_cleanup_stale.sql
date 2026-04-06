ALTER TABLE public.crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_status_check;

ALTER TABLE public.crawl_jobs
ADD CONSTRAINT crawl_jobs_status_check
CHECK (status IN (
  'pending',
  'running',
  'partial',
  'done',
  'error',
  'discovering',
  'crawling',
  'done_with_errors',
  'failed'
));

UPDATE public.crawl_jobs
SET
  status = 'partial',
  error = COALESCE(
    error,
    'Crawl interrupted before completion. You can resume from this job.'
  )
WHERE status IN ('running', 'discovering', 'crawling')
  AND pages_found > 0
  AND pages_indexed < pages_found
  AND updated_at < NOW() - INTERVAL '5 minutes';
