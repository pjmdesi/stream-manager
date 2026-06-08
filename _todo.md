# To-Do

## Discovery

* AlternativeTo listing (after 7-day account wait)
* Product Hunt listing (when ready for a possible traffic spike)
* Slant.co listing
* dev.to / Medium / Hacker News post linking to the site
* YouTube demo video with the URL in the description

## Improvement ideas

1. Add shorts upload functionality. Needs to be able to upload to YouTube.
2. Add ability to show assets from other streams in the same season/category when editing a stream item's thumbnail. This would be a toggle that shows/hides the assets from other stream items in the same season/category in the thumbnail editor's carousel. This would allow the user to easily reuse images from other stream items without having to manually find and add them to the current stream item. This should be opt-in since it could potentially add a lot of images to the carousel if the user has a lot of stream items in the same season/category, which could make it more difficult to find the images for the current stream item. It should be a small options icon in the assets title section, and clicking it would show a dropdown with the options to toggle: "show assets from season" and "show assets from category". If the user toggles on "show assets from season", then it would show the assets from all stream items in the same season as the current stream item. If they toggle on "show assets from category", then it would show the assets from all stream items in the same category as the current stream item. The user should be able to have both toggled on at the same time, which would show all assets from all stream items in the same season and category.
3. Add "clip on twitch" functionality. This is a bit more complex than the YouTube one, because Twitch clips are created through an API call that takes a start and end time, and then Twitch processes the clip and makes it available after a few minutes. We would need to have some kind of system for checking the status of the clip creation and updating the app when it's ready. We also need to make sure the user knows the limitations of twitch clips.
4. Upgrade the video counter tooltip to show more info such as the videos' thumbnails & encoding info. Add ability to delete video files from that tooltip. The new tooltip should be similar to the session videos section of the player page's sidebar. In fact we should create a new component for this type of tooltip that can be reused in both places. It will show a list of videos with their thumbnail, title, and encoding info, hydration status, timecode, allow the user to click on the filename to open it in the file explorer, and also have a delete button that sends the video to the recycle bin and removes it from the list.
5. Add a "default" tags template system where upon creating a new stream item, certain fields are automatically filled in with default values that can be chosen by a user in the templates dialog. Show a star icon next to each of the tag template items and when clicked, it sets that template as the default (similar to how the app handles the default launch group in the launcher page). Then when a new stream item is created, it checks if there is a default template set, and if so, it fills in the tags field with the values from that template.
6. Make audio-track extraction more useful by letting the user choose which audio track to pull out, rather than being locked to the first track. The current "Extract Audio (First Track)" preset is limited because MP3 only supports a single track, so the picker / additional logic likely needs to live outside the Converter page (e.g. a per-track export option in the Player) — design is open. Possibly there could be a new button added to each audio track row in the player page when in the Multi-track mode, allowing the user to save the extracted audio as an MP3 file (or maybe others). These would be sent to the converter with any necessary parameters to specify which track to extract and in what format.
7. Add a "Widgets" section to the help modal that includes documentation for the widgets in the app.
8. The widgets all have slightly different functionality in terms of visibility and what clicking on them does. I need to think about how to make them more consistent and intuitive for users.
9. Add ability for the user to create alternative thumbnails for stream items. It should be a dropdown next to the "Delete thumbnail" button in the thumbnail editor toolbar. It should say "New Thumbnail" or similar. When clicked, it should open the template selection modal that shows the available thumbnail templates, the same one that's used when clicking the thumbnail action button on the streams page stream item row when that stream item has no thumbnail created by SM yet. The modal in this case should also offer the ability to create a new thumbnail based on the current one, essentially duplicating it.
10. Add more drop shadow options in the thumbnail editor. The current one is a bit too subtle by default. A spread option would be ideal, but if that's not possible, maybe just add the ability to have multiple drop shadows on the same thumbnail, so the user could layer them to create a stronger shadow effect.
11. Add a "flip" option in the thumbnail editor that allows the user to flip layers horizontally or vertically. These 2 buttons would live next to the alignment buttons in the toolbar.
12. When double clicking the resize element for the youtube description field in the stream item edit page, it should reset the size to the default (showing all the text without scrolling).
13. Update the Claude AI preferences / system prompt textarea to match the rest of the design & functionality of the YouTube description textarea in the details sidebar of the new streams page. The auto-grow part is already in place via useAutoGrowTextarea; still need to add the drag-to-resize handle and switch from save-on-change to save-on-blur (the per-keystroke save is the source of the typing-lag the field has).
14. Add the jump to episode button like on the player page to the stream details sidebar (next to the skip buttons). This will only show the other episodes in the same season as the current stream item.
15. In the linked broadcast dropdown in the streams page details sidebar, the app needs to positively identify the "default" Youtube livestream (as opposed to scheduled broadcasts) because it's confusing when seeing an item that has out of date info and doesn't appear to be linked to anything. Use a design similar to the "already linked to x" element that appears underneath the broadcast details but make the coloring more neutral.
16. Currently, if a tag chip is too long to fit in the available space, it wraps and causes a bad visual. They need to show ellipsis instead and not wrap. Then a tooltip can show the full tag on hover.
17. Add detection for duplicate tags in the YouTube & Twitch tag fields in the stream item details sidebar. The tags with duplicates should be colored with a warning color and have a tooltip on hover that says "Duplicate tag".
18. Add indicators to the player, converter, & thumbnails nav items to indicate if there's something open in those pages. For instance, if the user has a thumbnail open in the thumbnail editor, the "Thumbnails" nav item could have a small dot on the right side of the button to indicate that there's an open thumbnail.

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

1. Getting an error in prod for going live. This may have been an issue with timing, but I'm not sure. The error message was: Couldn't go live — YouTube was receiving the stream but rejected the transition. The stream is still flowing; you can set it live in YT Studio.
2. In the details sidebar on the streams page. When the user selects a Topics/games tag that has a long name, the "{game}" field is also supposed to be automatically filled in with that tag's name.

## Other ideas (small)

1. Update the "Comments" section in the How to Use modal to reflect the rename to "Notes" and the removal of the old metadata edit modal — the section block (`<ElementSection title="Comments">` in HelpModal.tsx) and the surrounding "Edit / Add metadata" bullet both still describe the pre-rebuild UI.
2. Stream stats surface (location TBD — probably NOT the streams page sidebar; that's high-visibility real estate better used for workflow surfaces). Stream count, total hours streamed, top games/topics per month/year, longest stream, most-streamed game of all time, etc. Could live in its own page, a stats modal accessible from the streams page header, or a small "year in review" type card on the dashboard/launcher page.
3. Series momentum panel — likely lives in the streams page sidebar empty-state (alongside the planned month calendar). Lists active series (with at least one episode in the last N days) with last-streamed date + episode count, plus stalled series (last episode > 30d ago, never marked complete) with a "resume?" badge. Click a series → filter the streams list to it. Prerequisite: a way to mark a series as COMPLETE so finished games don't show up as stalled forever. Needs a new per-series "completed" flag (probably keyed off the game/topic tag, since series are inferred from {game, season}). UI for marking complete is open — right-click context menu on the panel entry, an action in the per-stream sidebar's metadata section, or a dedicated "series manager" view. Whatever shape it takes, "completed" should also influence the series-nav buttons in the detail sidebar header (last episode of a completed series shouldn't show a next-arrow that goes nowhere).
4. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
5. Add a main process console viewer for the production version of the app, accessible with a keyboard shortcut.
6. Maybe add a "streaming mode" that detects if there's an app that's currently recording (like OBS, Xsplit, or Streamlabs). This would allow the app to adapt in order to obscure sensitive info and perhaps even enter into a streamlined UI.
7. Relay feature ideas:
   * Add the ability to allow to the to add a "technical difficulties" fallback image so if the stream app (like OBS) crashes or the signal fails, it will instead push that image to YouTube as a backup until the stream app reconnects.
   * If it's possible to integrate Twitch's enhanced broadcast mode, allow the relay to send to multiple platforms (just Twitch and YouTube for now) at the same time
   * Allow the user to manage the editable details for each platform straight from SM. Maybe they change up what game they're playing or topic they're doing or otherwise what to flexibly update the details while streaming or right before.

## Other ideas (big)

1. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
   * Not sure if it should play through the SM app or just manage the files and the metadata for the music that's played through OBS.
   * Maybe it could serve a custom web page that displays in OBS as a browser source that shows the current track info and maybe even the album art or something in a customizable layout.
   * The biggest add for me would be a way to group music items into playlists so I can easily switch between different sets of music for different types of streams or different moods. This way, I won't have to manually edit the settings of the OBS music source every time I want to change up the music.
   * Maybe one day, there could even be a feature that allows the user's audience to vote on what music they want to hear during the stream through a Twitch extension or a website. And maybe even rate the music or suggest new tracks to add to the playlists. This would be a fun way to engage with the audience and make the music selection more interactive.
