-- Demo lead data for the Lead Engine: already-sourced venues + artist claims +
-- client enquiries across Pune / Mumbai / Jaipur, with mixed verification so
-- the "verified-first" ordering and the review queue are both visible.
-- Load into the live dev D1 with:
--   npx wrangler d1 execute mehfil --local --persist-to C:/tmp/mf --file=./leads-seed.sql

DELETE FROM lead_events;
DELETE FROM lead_interests;
DELETE FROM leads;

INSERT OR REPLACE INTO leads
  (id, kind, name, category, city, area, address, phone, website, instagram, email, source, external_id, dedupe_key, verification, verify_detail, status, wants_artists, rating, reviews_count, notes, created_by, last_checked_at)
VALUES
-- verified venues (as if pulled from Places and checked)
('ld_seed01','venue','Toast & Co','cafe','Pune','Baner','Survey 12, Baner Road',  '9876543210','https://toastandco.in','','','places','pl_toast','ph:9876543210','verified','{"phone":"ok","website":{"ok":true,"status":200}}','new',1,4.5,212,'Live acoustic sets on Fridays','system',datetime('now')),
('ld_seed02','venue','Saboro Lounge','lounge','Mumbai','Bandra West','Turner Rd, Bandra West','9820011223','https://saboro.in','','','places','pl_saboro','ph:9820011223','verified','{"phone":"ok"}','contacted',1,4.3,98,'Rooftop, DJ till 1am','system',datetime('now')),
('ld_seed03','venue','The Workshop Cafe','cafe','Pune','Viman Nagar','Midway, Viman Nagar','9822055667','https://theworkshopcafe.in','','','places','pl_workshop','ph:9822055667','verified','{"phone":"ok"}','new',1,4.6,340,'Open-mic host — books singers weekly','system',datetime('now')),
('ld_seed06','venue','Barbeque Nation','restaurant','Pune','Baner','Baner High Street','','https://bbqnation.in','','','places','pl_bbq','wb:bbqnation.in','verified','{"website":{"ok":true,"status":200}}','new',1,4.2,1200,'Family dining — needs background live music','system',datetime('now')),
('ld_seed07','venue','Social','cafe','Mumbai','Colaba','Colaba Causeway','','https://socialoffline.in','','','places','pl_social','wb:socialoffline.in','verified','{"website":{"ok":true,"status":200}}','new',1,4.4,890,'Hosts indie gigs','system',datetime('now')),
-- unverified venues (pending the verification pass)
('ld_seed04','venue','Club Vermillion','night club','Pune','Koregaon Park','Lane 6, KP','9860077889','https://clubvermillion.com','','','places','pl_ verm','ph:9860077889','unverified','{}','new',1,4.1,150,'','system',NULL),
('ld_seed05','venue','Grand Utsav Lawn','banquet','Jaipur','Malviya Nagar','Malviya Nagar Industrial Area','9829011001','','','','places','pl_utsav','ph:9829011001','unverified','{}','new',1,NULL,0,'Wedding season — big sangeet demand','system',NULL),
('ld_seed08','venue','Hawa Mahal Banquet','banquet','Jaipur','C-Scheme','Ashok Marg, C-Scheme','9887012345','','','','places','pl_hawa','ph:9887012345','unverified','{}','new',1,NULL,0,'','system',NULL),
-- artist self-registrations (claims)
('ld_seed10','artist','DJ Trance','dj','Mumbai','Andheri West','','9867700111','','djtrance','djtrance@gmail.com','claim','','ph:9867700111','verified','{"phone":"ok","email":"ok"}','new',1,NULL,0,'EDM + Bollywood mashups','claim',datetime('now')),
('ld_seed11','artist','Kabir & Co','band','Jaipur','','','9829055555','','kabirandco','','claim','','ph:9829055555','unverified','{}','new',1,NULL,0,'Sufi / Punjabi live band','claim',NULL),
('ld_seed12','artist','Meera Nair','singer','Pune','','','','','meeranair','meera.nair@gmail.com','claim','','em:meera.nair@gmail.com','verified','{"email":"ok"}','new',1,NULL,0,'Ghazal + acoustic','claim',datetime('now')),
('ld_seed13','artist','Aarij Qureshi','anchor','Mumbai','','','9821044444','','','','claim','','ph:9821044444','unverified','{}','new',1,NULL,0,'Bilingual emcee for corporate + college','claim',NULL),
-- client enquiries (demand side)
('ld_seed14','client','Zephyr Events','corporate','Mumbai','Lower Parel','','','https://zephyrevents.in','','hello@zephyrevents.in','csv','','wb:zephyrevents.in','verified','{"website":{"ok":true,"status":200},"email":"ok"}','interested',1,NULL,0,'Agency — books DJs + anchors for corporate nights','system',datetime('now')),
('ld_seed15','client','Riya Sharma','birthday','Pune','Kalyani Nagar','','9850012345','','','','csv','','ph:9850012345','verified','{"phone":"ok"}','new',1,NULL,0,'Wants a singer for a 60th birthday','system',datetime('now'));

INSERT INTO lead_events (lead_id, type, actor, note) VALUES
('ld_seed01','imported','system','Added via places'),
('ld_seed01','verified','system','Auto-check → verified'),
('ld_seed02','contacted','owner-approve','Outreach sent (owner-approve)'),
('ld_seed14','interested','u_meera','Meera Joshi wants this gig');

INSERT OR REPLACE INTO lead_interests (id, lead_id, artist_id, user_id, message, status) VALUES
('li_seed1','ld_seed14','a_meera','u_singer_meera','Available for corporate nights in Mumbai','pending');
