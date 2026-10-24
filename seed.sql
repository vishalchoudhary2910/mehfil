-- Mehfil seed data: launch-city demo marketplace.
-- Artists, packages, reviews, bookings (with escrow timeline), collab posts, shows.
-- Passwordless: real auth is Sign in with Freebuff; these users exist as
-- marketplace personas the signed-in demo account can book.

DELETE FROM rsvps;
DELETE FROM shows;
DELETE FROM collab_applications;
DELETE FROM collab_posts;
DELETE FROM reviews;
DELETE FROM booking_events;
DELETE FROM artist_booked_dates;
DELETE FROM bookings;
DELETE FROM packages;
DELETE FROM artist_profiles;
DELETE FROM users;

-- ---------------------------------------------------------------- users ----
INSERT INTO users (id, auth_sub, name, email, phone, city, kind) VALUES
  ('u_host_me',  'seed:host:me',  'You',           'you@mehfil.app',   '+91 90000 00001', 'Pune',  'host'),
  ('u_host_riya','seed:host:riya','Riya Kulkarni', 'riya@example.com','+91 98220 11111', 'Pune',  'host'),
  ('u_host_zephyr','seed:host:corp','Zephyr Cafés',  'ops@zephyr.example.com','+91 98220 22222','Mumbai','host'),
  ('u_dj_arjun', 'seed:artist:1', 'Arjun Nair',    'arjun@example.com','+91 99700 10101', 'Pune',  'artist'),
  ('u_dj_zoya',  'seed:artist:2', 'Zoya Rahman',   'zoya@example.com', '+91 99700 20202', 'Mumbai','artist'),
  ('u_singer_meera','seed:artist:3','Meera Joshi', 'meera@example.com','+91 99700 30303', 'Pune',  'artist'),
  ('u_band_neon','seed:artist:4','Kabir Sen',     'kabir@example.com','+91 99700 40404', 'Jaipur','artist'),
  ('u_anchor_dev','seed:artist:5','Devika Rao',   'devika@example.com','+91 99700 50505', 'Pune',  'artist'),
  ('u_singer_arij','seed:artist:6','Arijit Das',  'arijit@example.com','+91 99700 60606', 'Mumbai','artist'),
  ('u_dj_tara',  'seed:artist:7', 'Tara Menon',    'tara@example.com', '+91 99700 70707', 'Jaipur','artist'),
  ('u_band_qisse','seed:artist:8','Harpreet Gill', 'harpreet@example.com','+91 99700 80808','Pune', 'artist');

-- ------------------------------------------------------ artist profiles ----
INSERT INTO artist_profiles (id, user_id, slug, stage_name, category, sub_skills, city, languages, bio, experience_years, travel_radius_km, base_price_inr, rating, reviews_count, gigs_done, response_mins, verified, founding_artist, cancellation_policy, hue, instagram, youtube) VALUES
  ('a_arjun','u_dj_arjun','dj-arjun-pune','DJ Arjun','dj','["Bollywood","Deep House","Sufi Chill"]','Pune','["English","Hindi","Marathi"]','Wedding and house-party DJ with a warm, dancefloor-first sets. Ten years behind the decks across Pune banquet halls, rooftop cafes and kitty parties. Bring my own controller; can plug into any venue sound.',10,35,12000,4.8,37,210,12,1,1,'moderate',265,'@dj.arjun.pune','@dj.arjun'),
  ('a_zoya','u_dj_zoya','dj-zoya-mumbai','Zoya Rahman','dj','["Commercial","Afro House","Bollywood"]','Mumbai','["English","Hindi"]','Club and corporate DJ. Residencies at Bandra and Lower Parel venues, plus Diwali parties and college fests. Precision mixing, clean transitions, reads the floor fast.',7,40,18000,4.9,52,340,8,1,1,'strict',320,'@zoya.mixes',''),
  ('a_meera','u_singer_meera','meera-joshi-singer','Meera Joshi','singer','["Bollywood","Semi-Classical","Bhajan"]','Pune','["Hindi","Marathi","Sanskrit"]','Live vocalist for sangeets, house concerts and temple events. Trained Hindustani classical, ten years performing. Can lead a full band or perform with backing tracks.',12,30,8000,4.9,44,180,20,1,1,'flexible',15,'@meera.sings','@meerajoshi'),
  ('a_kabir','u_band_neon','neon-qisse-band','Neon Qisse','band','["Punjabi Live","Sufi","Fusion"]','Jaipur','["Punjabi","Hindi","English"]','Five-piece live band: vocals, guitar, bass, tabla, keys. Sufi nights, sangeets and corporate stage shows. Own PA and lighting rig available as add-on.',9,150,45000,4.7,29,120,35,1,0,'moderate',300,'@neonqisse','@neonqisse'),
  ('a_devika','u_anchor_dev','devika-rao-anchor','Devika Rao','anchor','["Sangeet","Corporate","Host"]','Pune','["English","Hindi","Marathi"]','Emcee and anchor for sangeets, award nights, kitty parties and college fests. Bilingual, quick on her feet, runs games and keeps the run-sheet on time.',6,25,6000,4.8,61,290,10,1,1,'moderate',200,'@devika.hosts',''),
  ('a_arij','u_singer_arij','arijit-das-ghazal','Arijit Das','singer','["Ghazal","Indie","Acoustic"]','Mumbai','["Hindi","Bengali","English"]','Unplugged acoustic sets for cafes, intimate weddings and art evenings. Guitar and voice, no backing track. Also records jingles and ad vocals remotely.',8,35,7000,4.6,23,95,25,0,1,'flexible',180,'@arijit.unplugged',''),
  ('a_tara','u_dj_tara','dj-tara-jaipur','Tara Menon','dj','["EDM","Retro Bollywood","Garba"]','Jaipur','["Hindi","English","Gujarati"]','Destination-wedding and Navratri specialist. Play garba till 2am and still land the Bollywood set. Travels with own controller and monitors.',5,200,15000,4.7,18,88,15,0,0,'strict',340,'@tara.beats',''),
  ('a_harpreet','u_band_qisse','qisse-acoustic-collective','Qisse Acoustic Collective','band','["Open Mic","Folk","Indie"]','Pune','["Punjabi","Hindi"]','Rotating acoustic collective that runs Pune open-mic nights. Duo or trio format for cafes and birthdays. Can also host and emcee the open mic themselves.',4,20,5000,4.5,12,60,45,0,1,'flexible',120,'@qisse.pune','');

-- ------------------------------------------------------------ packages ----
INSERT INTO packages (id, artist_id, name, description, price_inr, duration_hours, inclusions) VALUES
  ('p_arjun_1','a_arjun','House Party Starter','DJ + basic sound for house parties and kitty nights',12000,3,'["DJ performance","Own controller","Aux/backing tracks","Up to 3 hrs play"]'),
  ('p_arjun_2','a_arjun','Wedding Sangeet Night','Full sangeet coverage with MC coordination',28000,5,'["5 hr performance","Sound coordination with venue","Custom playlist call before event","Breaks managed"]'),
  ('p_arjun_3','a_arjun','Rooftop Sunset Set','Chill 2-hour sunset-to-dinner set for cafes and rooftops',9000,2,'["2 hr set","Ambient-to-danceflow arc","Own controller"]'),
  ('p_zoya_1','a_zoya','Club Night','Commercial + Afro house club set',35000,4,'["4 hr club set","Soundcheck","Backline check"]'),
  ('p_zoya_2','a_zoya','Corporate Party','Diwali party, annual day or brand event',45000,4,'["4 hrs","Family-friendly playlist option","Mic for speeches"]'),
  ('p_meera_1','a_meera','Sangeet Vocalist','Live singing for sangeet with backing tracks',18000,3,'["Live vocals 3 hrs","Custom song list","Rehearsal call included"]'),
  ('p_meera_2','a_meera','House Concert','Intimate unplugged concert, 30-60 guests',8000,1.5,'["90 min set","Classical + bhajan + ghazal","No sound system needed"]'),
  ('p_kabir_1','a_kabir','Neon Qisse Live','Full five-piece band night',45000,3,'["5-piece live band","3 sets with breaks","Own PA and monitors","Stage plot shared in advance"]'),
  ('p_kabir_2','a_kabir','Sangeet Band','Compact 3-piece for sangeets',28000,2,'["Vocals, guitar, tabla","2 sets","Mehendi-friendly volume"]'),
  ('p_devika_1','a_devika','Sangeet Anchor','Run-of-show anchor with games and family coordination',9000,4,'["Full run-sheet management","Mic handling","Games and segment hosting","Rehearsal call"]'),
  ('p_devika_2','a_devika','Corporate Emcee','Award nights, AGMs, college fests',15000,5,'["Bilingual hosting","Cue-sheet management","Announcements and awards"]'),
  ('p_arij_1','a_arij','Cafe Unplugged','Acoustic duo set for cafes and art evenings',7000,2,'["Guitar + voice","2 hrs","Request slots"]'),
  ('p_tara_1','a_tara','Navratri Garba Night','Garba + Bollywood dancefloor night',30000,4,'["4 hrs","Garba classics + Bollywood","Own controller and monitors"]'),
  ('p_tara_2','a_tara','Destination Wedding','Full wedding-weekend DJ coverage, 2 nights',55000,8,'["2 nights x 4 hrs","Travel from Jaipur included","Playlist planning call"]'),
  ('p_harpreet_1','a_harpreet','Open Mic Night','Hosted open mic with house duo',5000,3,'["Hosting + house set","PA via venue","Signup sheet management"]');

-- ------------------------------------------------------------ bookings ----
-- Demo booking history for the signed-in persona: one completed (with review),
-- one upcoming (escrow held, artist-confirmed) and one cancelled-refunded.
INSERT INTO bookings (id, host_id, artist_id, package_id, package_name, amount_inr, advance_inr, fee_inr, event_type, event_date, start_time, venue, city, guest_count, brief, status, escrow, policy, host_reviewed, artist_reviewed, created_at, updated_at) VALUES
  ('b_1','u_host_me','a_meera','p_meera_1','Sangeet Vocalist',18000,7200,1080,'Sangeet','2026-09-12','19:30','Hall 2, Seasons Banquet','Pune',220,'{"sound":"Venue has PA","power":"3 points on stage","songs":["Gerua","Kabira encore"],"dress":"Formal Indian","notes":"Baraat arrives 7pm"}','completed','released','moderate',1,1,'2026-09-01 10:12:00','2026-09-13 01:40:00'),
  ('b_2','u_host_me','a_devika','p_devika_1','Sangeet Anchor',9000,3600,540,'Sangeet','2026-11-08','18:00','Sanskriti Lawns','Pune',300,'{"sound":"Venue PA with 2 handhelds","power":"Generator backup","songs":["Family intro playlist"],"dress":"Lehenga / kurta","notes":"Cousin skit at 9pm"}','confirmed','held','moderate',0,0,'2026-10-18 21:05:00','2026-10-19 09:30:00'),
  ('b_3','u_host_me','a_arjun','p_arjun_1','House Party Starter',12000,4800,720,'Birthday','2026-08-20','20:00','Flat 904, Sunway Panorama','Pune',40,'{"sound":"Own BT speaker only","power":"One point","songs":[],"dress":"Casual","notes":"Society quiet hours 10pm"}','cancelled','refunded','flexible',0,0,'2026-08-14 11:00:00','2026-08-16 18:22:00');

INSERT INTO booking_events (booking_id, type, actor_id, note, created_at) VALUES
  ('b_1','booked','u_host_me','Advance of ₹7,200 sent to escrow','2026-09-01 10:12:00'),
  ('b_1','confirmed','u_singer_meera','Accepted. Rehearsal call on Thursday?','2026-09-01 12:40:00'),
  ('b_1','checked_in','u_singer_meera','Checked in at Sanskriti Lawns','2026-09-12 19:05:00'),
  ('b_1','completed','u_host_me','Beautiful set — crowd loved the bhajan medley','2026-09-12 23:50:00'),
  ('b_1','escrow_released',NULL,'₹7,200 released to Meera Joshi; balance payable offline per agreement','2026-09-13 01:40:00'),
  ('b_2','booked','u_host_me','Advance of ₹3,600 sent to escrow','2026-10-18 21:05:00'),
  ('b_2','confirmed','u_anchor_dev','Confirmed! Sharing a run-sheet template tomorrow.','2026-10-19 09:30:00'),
  ('b_3','booked','u_host_me','Advance of ₹4,800 sent to escrow','2026-08-14 11:00:00'),
  ('b_3','cancelled','u_host_me','Society denied permission for loud music','2026-08-16 18:20:00'),
  ('b_3','refunded',NULL,'Flexible policy — full refund of ₹4,800 issued','2026-08-16 18:22:00');

INSERT INTO artist_booked_dates (artist_id, date, booking_id) VALUES
  ('a_devika','2026-11-08','b_2');

-- -------------------------------------------------------------- reviews ----
INSERT INTO reviews (id, booking_id, reviewer_id, artist_id, for_host, rating, comment, created_at) VALUES
  ('r_1','b_1','u_host_me','a_meera',1,5,'Meera learned our three family songs in four days and the bhajan medley had everyone in tears. On time, calm, professional.','2026-09-13 09:10:00'),
  ('r_2','b_1','u_singer_meera','a_meera',0,5,'Lovely family, venue had everything promised. Would happily play their next event.','2026-09-13 14:02:00');

-- Public reviews for the marketplace from other seeded hosts. Each is tied to
-- its own completed booking so foreign keys and the unique constraint hold.
INSERT INTO bookings (id, host_id, artist_id, package_id, package_name, amount_inr, advance_inr, fee_inr, event_type, event_date, start_time, venue, city, guest_count, brief, status, escrow, policy, host_reviewed, artist_reviewed, created_at, updated_at) VALUES
  ('b_r3','u_host_riya','a_arjun','p_arjun_1','House Party Starter',12000,4800,720,'Birthday','2026-06-14','20:00','Kalyani Nagar','Pune',60,'{}','completed','released','moderate',1,0,'2026-06-01 10:00:00','2026-06-15 02:00:00'),
  ('b_r4','u_host_zephyr','a_zoya','p_zoya_2','Corporate Party',45000,18000,2700,'Corporate','2026-05-02','19:00','Zephyr Bandra','Mumbai',180,'{}','completed','released','strict',1,0,'2026-04-20 10:00:00','2026-05-03 01:00:00'),
  ('b_r5','u_host_riya','a_devika','p_devika_1','Sangeet Anchor',9000,3600,540,'Sangeet','2026-04-18','18:00','Baner Lawns','Pune',250,'{}','completed','released','moderate',1,0,'2026-04-05 10:00:00','2026-04-19 01:00:00'),
  ('b_r6','u_host_zephyr','a_kabir','p_kabir_1','Neon Qisse Live',45000,18000,2700,'Corporate','2026-03-21','20:00','Zephyr Fest Stage','Mumbai',400,'{}','completed','released','moderate',1,0,'2026-03-08 10:00:00','2026-03-22 01:00:00'),
  ('b_r7','u_host_riya','a_meera','p_meera_2','House Concert',8000,3200,480,'House Party','2026-02-08','18:30','Koregaon Park Residence','Pune',50,'{}','completed','released','flexible',1,0,'2026-02-01 10:00:00','2026-02-09 01:00:00'),
  ('b_r8','u_host_riya','a_tara','p_tara_1','Navratri Garba Night',30000,12000,1800,'Club Night','2026-10-04','20:00','University Ground','Jaipur',600,'{}','completed','released','strict',1,0,'2026-09-20 10:00:00','2026-10-05 02:00:00'),
  ('b_r9','u_host_riya','a_arij','p_arij_1','Cafe Unplugged',7000,2800,420,'College Fest','2026-08-09','19:00','Art Evening, Colaba','Mumbai',70,'{}','completed','released','flexible',1,0,'2026-08-01 10:00:00','2026-08-10 01:00:00'),
  ('b_r10','u_host_riya','a_harpreet','p_harpreet_1','Open Mic Night',5000,2000,300,'House Party','2026-07-12','19:00','The Workshop Cafe','Pune',45,'{}','completed','released','flexible',1,0,'2026-07-05 10:00:00','2026-07-13 01:00:00'),
  ('b_r11','u_host_riya','a_arjun','p_arjun_3','Rooftop Sunset Set',9000,3600,540,'Birthday','2026-09-27','18:00','Skydeck, Viman Nagar','Pune',55,'{}','completed','released','moderate',1,0,'2026-09-15 10:00:00','2026-09-28 01:00:00');

INSERT INTO reviews (id, booking_id, reviewer_id, artist_id, for_host, rating, comment, created_at) VALUES
  ('r_3','b_r3','u_host_riya','a_arjun',1,5,'Arjun read the room perfectly — 60-year-olds and college kids both on the floor.','2026-06-15 10:00:00'),
  ('r_4','b_r4','u_host_zephyr','a_zoya',1,5,'Zoya played our Diwali party like a residency. Clean, punctual, zero hand-holding needed.','2026-05-03 10:00:00'),
  ('r_5','b_r5','u_host_riya','a_devika',1,5,'Devika held a 4-hour sangeet run-sheet to the minute and kept three chaotic families happy.','2026-04-19 10:00:00'),
  ('r_6','b_r6','u_host_zephyr','a_kabir',1,5,'Neon Qisse’s Sufi set closed our festival. Rig arrived early, sound was huge.','2026-03-22 10:00:00'),
  ('r_7','b_r7','u_host_riya','a_meera',1,5,'Classical depth most “Bollywood singers” don’t have.','2026-02-09 10:00:00'),
  ('r_8','b_r8','u_host_riya','a_tara',1,5,'Tara played garba till 2am and still landed the Bollywood finale.','2026-10-05 10:00:00'),
  ('r_9','b_r9','u_host_riya','a_arij',1,4,'Perfect for our art-evening. Wish they could play a third hour.','2026-08-10 10:00:00'),
  ('r_10','b_r10','u_host_riya','a_harpreet',1,4,'Ran our cafe open mic — every first-timer felt welcome.','2026-07-13 10:00:00'),
  ('r_11','b_r11','u_host_riya','a_arjun',1,5,'Golden-hour set was exactly right. Booking him again for the New Year party.','2026-09-28 10:00:00');

-- ----------------------------------------------------------- collab posts --
INSERT INTO collab_posts (id, author_id, artist_id, title, role_needed, city, date, pay_inr, details, status, created_at) VALUES
  ('c_1','u_singer_meera','a_meera','Need a tabla player for a sangeet this Saturday','Tabla player','Pune','2026-11-02',3000,'Two 20-minute sets with a singer. Sound provided. Rehearsal Friday evening, Baner.','open','2026-10-22 09:00:00'),
  ('c_2','u_band_neon','a_kabir','Neon Qisse — bassist for Jaipur wedding weekend','Bassist','Jaipur','2026-12-05',8000,'Three nights, travel and stay covered. Setlist shared a week ahead.','open','2026-10-20 18:30:00'),
  ('c_3','u_dj_arjun','a_arjun','Looking for an MC to co-host a New Year bash','Emcee','Pune','2026-12-31',5000,'Countdown host, crowd games, bilingual. Club venue, Colleem Road.','open','2026-10-23 11:15:00'),
  ('c_4','u_anchor_dev','a_devika','Second anchor for college fest (two days)','Emcee','Pune','2026-11-14',6000,'Day 1 and day 2, 10am-6pm. Campus in Wagholi, transport covered.','open','2026-10-21 16:45:00');

-- ---------------------------------------------------------------- shows ----
INSERT INTO shows (id, creator_id, title, performers, venue, city, date, start_time, is_free, price_inr, capacity, description, created_at) VALUES
  ('s_1','u_band_qisse','Qisse Open Mic Night #41','Qisse Acoustic Collective + open signup','The Workshop Cafe','Pune','2026-10-30','20:00',1,0,60,'Sign up on the spot from 7:30. House duo plays between slots. Everyone welcome.','2026-10-15 12:00:00'),
  ('s_2','u_singer_meera','Meera Joshi — Intimate Ghazal Evening','Meera Joshi','Darwara Art Cafe','Pune','2026-11-15','19:30',0,400,50,'Forty seats, four-row cabaret style. Includes chai. Limited tickets at the door.','2026-10-16 12:00:00'),
  ('s_3','u_dj_zoya','Zoya Rahman — Rooftop Sessions','Zoya Rahman','Skylounge, Andheri','Mumbai','2026-11-07','21:00',0,300,120,'Afro house and Bollywood on a November rooftop. Entry by RSVP.','2026-10-17 12:00:00');

INSERT INTO rsvps (show_id, user_id) VALUES
  ('s_1','u_host_me'),
  ('s_2','u_host_me'),
  ('s_2','u_host_riya'),
  ('s_3','u_host_riya');

-- Recompute denormalised profile stats from the seeded reviews.
UPDATE artist_profiles SET
  rating = (SELECT ROUND(AVG(rating),1) FROM reviews r WHERE r.artist_id = artist_profiles.id AND for_host = 1),
  reviews_count = (SELECT COUNT(*) FROM reviews r WHERE r.artist_id = artist_profiles.id AND for_host = 1);

-- ------------------------------------------- new talent categories (demo) ----
-- Poets/shayars, comics, dancers and dhol are first-class categories in the
-- shared taxonomy. These quote-per-gig profiles show the freelance path:
-- no packages, hosts send a brief and the act replies with a price.
INSERT INTO users (id, auth_sub, name, email, phone, city, kind) VALUES
  ('u_poet_sukhan','seed:artist:9','Awaaz Ali','awaaz@example.com','+91 99700 90909','Pune','artist'),
  ('u_comic_rehan','seed:artist:10','Rehan Qureshi','rehan@example.com','+91 99700 10110','Pune','artist'),
  ('u_dance_nritya','seed:artist:11','Nritya Collective','nritya@example.com','+91 99700 11111','Jaipur','artist'),
  ('u_dhol_baaje','seed:artist:12','Dhol Baaje','dholbaaje@example.com','+91 99700 12121','Pune','artist');

INSERT INTO artist_profiles (id, user_id, slug, stage_name, category, sub_skills, city, languages, bio, experience_years, travel_radius_km, base_price_inr, rating, reviews_count, gigs_done, response_mins, verified, founding_artist, cancellation_policy, hue, instagram, youtube) VALUES
  ('a_sukhan','u_poet_sukhan','sukhan-shayari','Sukhan','poet','["Urdu Shayari","Mushaira","Sufi Poetry"]','Pune','["Hindi","Urdu","English"]','Shayar and spoken-word artist. Mushairas, cafe poetry nights and sangeet-mehndi evenings — Urdu nazm, Hindi kavita and a Sufi closing set. Quote per brief; travels light with a mic and a harmonium player when needed.',7,80,0,4.9,14,42,15,1,1,'flexible',280,'@sukhan.live',''),
  ('a_rehan','u_comic_rehan','rehan-qureshi-comedy','Rehan Qureshi','comedian','["Stand-up","Crowd Work","Corporate"]','Pune','["Hindi","English","Marathi"]','Stand-up comic and crowd-work host. Corporate sets, college festivals and late-night cafe shows. Clean or adult set depending on the room — tell me the brief and I will shape it.',5,120,0,4.7,21,63,25,1,0,'moderate',190,'@rehan.quips',''),
  ('a_nritya','u_dance_nritya','nritya-collective','Nritya Collective','dancer','["Kathak","Sufi","Sangeet Choreo"]','Jaipur','["Hindi","Rajasthani","English"]','Six-dancer troupe blending Kathak with contemporary sufi choreography. Sangeet entries, destination-wedding showcases and festival stages. Choreography for family members included on request.',9,250,0,4.8,18,76,40,1,1,'strict',30,'@nritya.collective',''),
  ('a_dholbaaje','u_dhol_baaje','dhol-baaje-pune','Dhol Baaje','dhol','["Dhol","Tasha","Wedding Procession"]','Pune','["Marathi","Hindi"]','Four-dhol and tasha troupe for baraat processions, sangeet entries and sports finals. Loud, tight and on time; travel across Maharashtra and Goa.',6,200,0,4.9,33,188,10,1,1,'flexible',345,'@dholbaaje','');

-- Free & paid shows across the new categories.
INSERT INTO shows (id, creator_id, title, performers, venue, city, date, start_time, is_free, price_inr, capacity, description, created_at) VALUES
  ('s_4','u_poet_sukhan','Mushaira Under the Neem — Sukhan & guests','Sukhan + open shayari signup','Darwara Art Cafe','Pune','2026-11-08','19:30',1,0,70,'An evening of Urdu nazm and Hindi kavita. Open signup from 7 pm, chai on the house.','2026-10-18 12:00:00'),
  ('s_5','u_comic_rehan','Stand-up Open Mic #12 — Pune','Rehan Qureshi + 8 comics','The Workshop Cafe','Pune','2026-11-21','20:30',0,250,80,'Eight comics, one headliner, zero filter. Tickets at the door, first row is a choice.','2026-10-19 12:00:00'),
  ('s_6','u_dance_nritya','Kathak & Sufi — Nritya Collective','Nritya Collective','Jawahar Kala Kendra','Jaipur','2026-12-04','19:00',0,500,200,'Six dancers, live sarangi and tabla. A 70-minute showcase followed by a meet-the-troupe session.','2026-10-20 12:00:00');
