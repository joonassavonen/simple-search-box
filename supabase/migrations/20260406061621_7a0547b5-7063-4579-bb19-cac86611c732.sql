ALTER TABLE public.crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_status_check;

ALTER TABLE public.crawl_jobs
ADD CONSTRAINT crawl_jobs_status_check
CHECK (status IN (
  'pending',
  'running',
  'done',
  'error',
  'discovering',
  'crawling',
  'done_with_errors',
  'failed'
));