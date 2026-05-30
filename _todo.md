# To-Do

## Discovery

* AlternativeTo listing (after 7-day account wait)
* Product Hunt listing (when ready for a possible traffic spike)
* Slant.co listing
* dev.to / Medium / Hacker News post linking to the site
* YouTube demo video with the URL in the description

## Improvement ideas

1. When navigating away from the settings page and there are unsaved changes, show a confirmation modal asking the user if they want to save their changes, discard them, or cancel the navigation. This will help prevent accidental loss of changes.
2. Add shorts upload functionality. Needs to be able to upload to YouTube.
3. Add ability to show assets from other streams in the same season/category when editing a stream item's thumbnail. This would be a toggle that shows/hides the assets from other stream items in the same season/category in the thumbnail editor's carousel. This would allow the user to easily reuse images from other stream items without having to manually find and add them to the current stream item. This should be opt-in since it could potentially add a lot of images to the carousel if the user has a lot of stream items in the same season/category, which could make it more difficult to find the images for the current stream item. It should be a small options icon in the assets title section, and clicking it would show a dropdown with the options to toggle: "show assets from season" and "show assets from category". If the user toggles on "show assets from season", then it would show the assets from all stream items in the same season as the current stream item. If they toggle on "show assets from category", then it would show the assets from all stream items in the same category as the current stream item. The user should be able to have both toggled on at the same time, which would show all assets from all stream items in the same season and category.
4. Add "clip on twitch" functionality. This is a bit more complex than the YouTube one, because Twitch clips are created through an API call that takes a start and end time, and then Twitch processes the clip and makes it available after a few minutes. We would need to have some kind of system for checking the status of the clip creation and updating the app when it's ready. We also need to make sure the user knows the limitations of twitch clips.
5. Fill out converter section in help modal to describe the conversion presets in detail and about importing/exporting presets as well.
6. Add ability to delete images in the carousels on the stream item page and in the metamodal. Show a delete button next to the "Set as item thumbnail" button that turns into a confirmation/cancel pair, then when confirmed send the image to the user's recycle bin and remove it from the carousel. The button should only show for images that are not set as the thumbnail for the item.
7. Upgrade the video counter tooltip to show more info such as the videos' thumbnails & encoding info. Add ability to delete video files from that tooltip. The new tooltip should be similar to the session videos section of the player page's sidebar. In fact we should create a new component for this type of tooltip that can be reused in both places. It will show a list of videos with their thumbnail, title, and encoding info, hydration status, timecode, allow the user to click on the filename to open it in the file explorer, and also have a delete button that sends the video to the recycle bin and removes it from the list.
8. Allow editing a linked YouTube broadcast's privacy (Public / Unlisted / Private) from within the app — currently only settable at creation time (via the reschedule modal's "create YouTube livestream" flow). Needs: new `updateBroadcastStatus` service fn + `youtube:updateBroadcastStatus` IPC + preload binding, plus a small privacy selector in MetaModal next to the linked YouTube broadcast info. YouTube API supports this via `liveBroadcasts.update?part=status`.
9. In the thumbnail editor, allow pasting an image from the clipboard, and save it to the stream item folder as a separate image file (in whatever format makes the most sense, possibly PNG to preserve quality and transparency if it has it, no compression needed).
10. Consider removing the additional list of thumbnail options in the metamodal that allows the user to pick which image is uploaded to YouTube. Maybe just default to whatever is used as the stream item thumbnail and just have a checkbox (checked by default) that says "Use stream item thumbnail as YouTube thumbnail" or something like that. If the user unchecks it, then show the additional options for picking a different image from the carousel to use as the YouTube thumbnail. This will simplify the UI and reduce confusion for users who don't need that level of control, while still allowing power users to customize it if they want.
11. If possible, when the user deletes a stream item, it should offer the option to also delete the linked YouTube livestream VOD or video if there is one, and if they confirm, it will delete the broadcast through the YouTube API.
12. Maybe?... Update the "new stream" version of the metamodal to automatically save the stream item as soon as the user fills anything into the title and clicks out of the input, instead of waiting for them to click the "Save" button at the bottom.
13. Add a "default" tags template system where upon creating a new stream item, certain fields are automatically filled in with default values that can be chosen by a user in the templates dialog. Show a star icon next to each of the tag template items and when clicked, it sets that template as the default (similar to how the app handles the default launch group in the launcher page). Then when a new stream item is created, it checks if there is a default template set, and if so, it fills in the tags field with the values from that template.
14. It looks like there's room to add the ETA of conversion tasks in the conversion widget in the nav sidebar of the app. If it's able to be calculated (no "pending" or tasks, ie tasks waiting on cloud sync or waiting for other conversions to finish before starting), then show a sum of all the ETAs for all items "in-progress" to the right of the "X Jobs" text in the widget.

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

None for now

## Other ideas (small)

1. Rename the comments feature in the stream items to "Notes" instead. Also update that entry in the How to Use section.
2. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
3. Add a main process console viewer for the production version of the app, accessible with a keyboard shortcut.
4. Maybe add a "streaming mode" that detects if there's an app that's currently recording (like OBS, Xsplit, or Streamlabs). This would allow the app to adapt in order to obscure sensitive info and perhaps even enter into a streamlined UI.
5. Relay feature ideas:
   * Add the ability to allow to the to add a "technical difficulties" fallback image so if the stream app (like OBS) crashes or the signal fails, it will instead push that image to YouTube as a backup until the stream app reconnects.
   * If it's possible to integrate Twitch's enhanced broadcast mode, allow the relay to send to multiple platforms (just Twitch and YouTube for now) at the same time
   * Allow the user to manage the editable details for each platform straight from SM. Maybe they change up what game they're playing or topic they're doing or otherwise what to flexibly update the details while streaming or right before.

## Other ideas (big)

1. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
   * Not sure if it should play through the SM app or just manage the files and the metadata for the music that's played through OBS.
   * Maybe it could serve a custom web page that displays in OBS as a browser source that shows the current track info and maybe even the album art or something in a customizable layout.
   * The biggest add for me would be a way to group music items into playlists so I can easily switch between different sets of music for different types of streams or different moods. This way, I won't have to manually edit the settings of the OBS music source every time I want to change up the music.
   * Maybe one day, there could even be a feature that allows the user's audience to vote on what music they want to hear during the stream through a Twitch extension or a website. And maybe even rate the music or suggest new tracks to add to the playlists. This would be a fun way to engage with the audience and make the music selection more interactive.
