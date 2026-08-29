-- Defense in depth for the org-media bucket: the client already checks
-- file type/size before calling storage.upload() (see SettingsClient.tsx),
-- but that only stops the normal UI path — nothing at the bucket level
-- previously stopped a direct API call from uploading an oversized file
-- or an arbitrary (non-image) MIME type into a bucket serving public URLs.
update storage.buckets
set file_size_limit = 5242880, -- 5MB, matches the client-side check
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'org-media';
