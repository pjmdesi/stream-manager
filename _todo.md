# To-Do

## Discovery

* AlternativeTo listing (after 7-day account wait)
* Product Hunt listing (when ready for a possible traffic spike)
* Slant.co listing
* dev.to / Medium / Hacker News post linking to the site
* YouTube demo video with the URL in the description

## Improvement ideas

1. Add shorts upload functionality. Needs to be able to upload to YouTube.
2. Add a small options icon in the assets panel title on the thumbnail editor page in the properties sidebar. Clicking it would show a dropdown with the options to toggle: "show assets from season" and "show assets from category". If the user toggles on "show assets from season", then it would show the assets from all stream items in the same season as the current stream item. If they toggle on "show assets from category", then it would show the assets from all stream items in the same category as the current stream item. The user should be able to have both toggled on at the same time, which would show all assets from all stream items in the same season and category.
3. Add "clip on twitch" functionality. This is a bit more complex than the YouTube one, because Twitch clips are created through an API call that takes a start and end time, and then Twitch processes the clip and makes it available after a few minutes. We would need to have some kind of system for checking the status of the clip creation and updating the app when it's ready. We also need to make sure the user knows the limitations of twitch clips.
4. Upgrade the video counter tooltip to show more info such as the videos' thumbnails & encoding info. Add ability to delete video files from that tooltip. The new tooltip should be similar to the session videos section of the player page's sidebar. In fact we should create a new component for this type of tooltip that can be reused in both places. It will show a list of videos with their thumbnail, title, and encoding info, hydration status, timecode, allow the user to click on the filename to open it in the file explorer, and also have a delete button that sends the video to the recycle bin and removes it from the list.
5. Add a "default" tags template system where upon creating a new stream item, certain fields are automatically filled in with default values that can be chosen by a user in the templates dialog. Show a star icon next to each of the tag template items and when clicked, it sets that template as the default (similar to how the app handles the default launch group in the launcher page). Then when a new stream item is created, it checks if there is a default template set, and if so, it fills in the tags field with the values from that template.
6. Make audio-track extraction more useful by letting the user choose which audio track to pull out, rather than being locked to the first track. The current "Extract Audio (First Track)" preset is limited because MP3 only supports a single track, so the picker / additional logic likely needs to live outside the Converter page (e.g. a per-track export option in the Player) — design is open. Possibly there could be a new button added to each audio track row in the player page when in the Multi-track mode, allowing the user to save the extracted audio as an MP3 file (or maybe others). These would be sent to the converter with any necessary parameters to specify which track to extract and in what format.
7. Add the ability for the launcher to track which of the apps in each launch group are still open and allow the user to quit them from the launcher. Need to discuss design. We could also add more options to the launcher group items after this such as 2 boolean options: Close with group (checked by default, unchecked means it won't quit when the user clicks the "Quit Group", for example, an app that the user would like to keep open after streaming), and Allow multiple instances (unchecked by default, checked means the app could be attempted to be launched multiple times when the group or individual launch buttons are clicked. Might need to check if it's possible to know if an app can have multiple instances so there's a smaller chance of conflict. If we can, the checkbox would not appear for those apps).
8. The widgets all have slightly different functionality in terms of visibility and what clicking on them does. I need to think about how to make them more consistent and intuitive for users.
9.  More keyboard shortcuts on the streams page. If a button does the same thing, add the shortcut to the tooltip for that button as smaller, slightly darker text as the last item in the tooltip. We should list the shortcuts in the help modal in their own category. We should move the current player shortcuts to that category as well under their own section. Global app shortcuts will have their own section and page-specific shortcuts will also go under respective sections. Some ideas for shortcuts:
    1. ctrl+up/down to navigate the stream items while the detail sidebar is open.
    2. ctrl+shift+r to start the reschedule process for a stream item while the detail sidebar is open.
    3. ctrl+shift+t to open the thumbnail editor for a stream item while the detail sidebar is open.
    4. ctrl+shift+up/down to navigate between SM pages (streams, player, converter, thumbnails) from anywhere in the app.
    5. ctrl+shift+w to start/stop the watcher anywhere in the app.
    6. ctrl+shift+y to start/stop the YouTube relay anywhere in the app.
10. Update the Broadcast Privacy buttons for a connected stream item in the details sidebar to match the combined button layout used in the calendar settings popup. The styling should stay the same for the buttons, but they should be shoved together and the border radii adapted so it looks like they're part of the same control.
11. Build a chat viewer that can connect to the YouTube and Twitch APIs to show the live chat for the active broadcast. This would be a new page in the app that shows the chat messages in real time, along with some basic info about the chat such as the number of viewers for each platform, and maybe some basic moderation tools like the ability to delete messages or ban users.
12. Create a Stream Dashboard pop-out window. This would essentially be a trimmed-down controller for SM which would show info essential for the active stream. This would be one way to show the chat messages in the item above. Additionally it could show the relay status and stats. Also the user would be able to use this to change the stream details live for all platforms at the same time (for instance if they switch games mid-stream, or come up with a better title while streaming). Not sure if this should be a separate exe that the user ca launch separately from SM if they want (it would read the same _meta.json for the info it needs) or if SM should have to be open to have it work. Would need to think through that. Would need a minimal, but effective layout & design.
13. The settings page needs some restructuring. It has gotten much larger since it was created. Initial things to fix: spacing between items. Add relevant icons to the sections for easy scanning. Maybe some jump buttons at the top to jump to each section (they would be sticky so they stay visible on scroll, and they would become active as the different sections are scrolled into view). It would probably look better if the content were centered on the page as well instead of left-aligned.
14. The window buttons need to be nudged over to the right a bit. The spacing from the right edge of the window to the close button should match the spacing from the top edge of the window to the buttons.
15. Need figure out a way to update the YouTube category & game title... I forgot to do that for several streams. Maybe if SM definitely cannot update it automatically, when pushing to YouTube we show a reminder to the user to go update the category and game title if they haven't already.

## Ongoing Tasks

1. Continue building out the relay functionality (waiting for full testing of phase 1, requires actual usage of new features):
   a. Phase 2 — Documentation polish (1–2 hours):
      * HelpModal — new section under YouTube integration covering setup, the active-broadcast workflow, and the streaming-app config block.
      * README — bump the "Integrations → YouTube" bullet to mention the relay; possibly a dedicated relay sub-bullet.
      * No code changes; just docs.
   b. Phase 3 — UI polish on the Integrations card (small, ~30 min):
      * The widget shows live kbps/duration/grace countdown while streaming, but the Integrations card still just shows the status pill. Could mirror the lifecycle stage + stats there too, since users on the setup page during their first stream would otherwise wonder if it's working.
      * Optional, not blocking — happy to skip if the widget visibility is enough.
   c. Phase 4 — Tech-difficulties fallback image (from your _todo.md item 6):
      * When the inbound RTMP drops, keep the outbound RTMP to YouTube alive by ffmpeg-piping a still image + silent audio until the inbound returns. Concrete spec, just a real chunk of work — restructures the relay into "always one ffmpeg connected to YouTube, swap input source when OBS comes/goes."
      * Bigger lift than the prior phases; worth doing only if you actually hit a use case in real streams.

## Bugs

1. The tooltip for the calendar settings button is showing above, it should show to the left.
2. The auto Go Live for the relay didn't work again. I opened YouTube Studio after a bit and tracked to see when YouTube actually received the stream and it seems like it takes too long to serve the Go Live action. I'm not sure, but I think the streamer might have to have Studio opened in order for the Go Live action to actually activate. If there is a way to check this that would be great. When OBS has YouTube set as the platform, it pulls up a built-in browser window with YouTube studio. Maybe we have to do a similar thing?

## Other ideas (small)

1. Stream stats surface (location TBD — probably NOT the streams page sidebar; that's high-visibility real estate better used for workflow surfaces). Stream count, total hours streamed, top games/topics per month/year, longest stream, most-streamed game of all time, etc. Could live in its own page, a stats modal accessible from the streams page header, or a small "year in review" type card on the dashboard/launcher page.
2. Series momentum panel — likely lives in the streams page sidebar empty-state (alongside the planned month calendar). Lists active series (with at least one episode in the last N days) with last-streamed date + episode count, plus stalled series (last episode > 30d ago, never marked complete) with a "resume?" badge. Click a series → filter the streams list to it. Prerequisite: a way to mark a series as COMPLETE so finished games don't show up as stalled forever. Needs a new per-series "completed" flag (probably keyed off the game/topic tag, since series are inferred from {game, season}). UI for marking complete is open — right-click context menu on the panel entry, an action in the per-stream sidebar's metadata section, or a dedicated "series manager" view. Whatever shape it takes, "completed" should also influence the series-nav buttons in the detail sidebar header (last episode of a completed series shouldn't show a next-arrow that goes nowhere).
3. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
4. Add a main process console viewer for the production version of the app, accessible with a keyboard shortcut.
5. Maybe add a "streaming mode" that detects if there's an app that's currently recording (like OBS, Xsplit, or StreamLabs). This would allow the app to adapt in order to obscure sensitive info and perhaps even enter into a streamlined UI.
6. Relay feature ideas:
   * Add the ability to allow to the to add a "technical difficulties" fallback image so if the stream app (like OBS) crashes or the signal fails, it will instead push that image to YouTube as a backup until the stream app reconnects.
   * If it's possible to integrate Twitch's enhanced broadcast mode, allow the relay to send to multiple platforms (just Twitch and YouTube for now) at the same time
   * Allow the user to manage the editable details for each platform straight from SM. Maybe they change up what game they're playing or topic they're doing or otherwise what to flexibly update the details while streaming or right before. 

## Other ideas (big)

1. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
   * Not sure if it should play through the SM app or just manage the files and the metadata for the music that's played through OBS.
   * Maybe it could serve a custom web page that displays in OBS as a browser source that shows the current track info and maybe even the album art or something in a customizable layout.
   * The biggest add for me would be a way to group music items into playlists so I can easily switch between different sets of music for different types of streams or different moods. This way, I won't have to manually edit the settings of the OBS music source every time I want to change up the music.
   * Maybe one day, there could even be a feature that allows the user's audience to vote on what music they want to hear during the stream through a Twitch extension or a website. And maybe even rate the music or suggest new tracks to add to the playlists. This would be a fun way to engage with the audience and make the music selection more interactive.
