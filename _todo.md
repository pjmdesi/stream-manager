# To-Do

## Improvement ideas

1. Add more info to onboarding step 1.5 to tell user about the reasons to not use dump mode including the tools the app provides to help with organization in folder-per-stream mode
2. Might need another organization mode which is like dump mode, but the used has some organization. For instance, user might have streams placed into year folders, but all the items in each year folder is loose.
3. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
4. Change the app background to more of a gray color so it's more neutral. Maybe also change the main color from purple so it's not so closely matched to twitch. Maybe a blue?
5. Add memory for conversion items so that if th app restarts, the items in the queue will reappear in the converter page. (only items in the queue, not anything that was actually started/paused/canceled/errored/completed).
6. Add ability for user to name/title auto-rules tasks, in case the details are similar in some of them and they want an easy way to identify. It should be optional.
7. Add a check for quitting the app for if any conversions are currently in progress, and if so, show a confirmation dialog to the user asking if they are sure they want to quit and lose their progress on those conversions. This will help prevent users from accidentally quitting the app while they have conversions in progress, and give them a chance to cancel the quit action if they didn't mean to do it.
8. Add shorts view & upload functionality. Will need to enhance clipping feature to save shorts more fully. Will need to build a place to manage them. Might need to be a separate shorts page or upgrade the streams page to be able to handle both streams and their related shorts.
9. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
10. Bleep markers in the clipper tool need to have their duration value editable by using the arrow keys. I think .1 precision.
11. Update the thumbnail Template selector in the new stream dialog to also refer to the built-in thumbnail templates. Add a checkbox which says "use built-in thumbnail creator" and when it's checked, the dropdown will show the app's list of thumbnail templates. When unchecked it will show the fields currently there now. We also need to update the settings page to add whether this checkbox is selected by default for new streams (it should be on by default if the user has not changed the setting). Then we update the wording to the current "Default thumbnail template" to "Default external thumbnail template" and add a new setting for "Default built-in thumbnail template" which will be the default template selected in the thumbnail template dropdown when the "use built-in thumbnail creator" checkbox is checked in the new stream dialog. This will make it easier for users to use the app's built-in thumbnail creator and templates, while still allowing them to use external thumbnail templates if they prefer. If no default built-in thumbnail exists, offer a "Create Thumbnail Template" button next to the default built-in thumbnail template dropdown that takes the user to the thumbnail template editor to create a new built-in thumbnail template.
12. We need to add keyboard shortcuts to the player page. Full suite, based on other video editing apps.
13. Need to rebuild / significantly upgrade the bulk archive process to take into account the player & clips functionality. For instance, if the user chooses to append all the video files with "-archive" or something, all the relationships with the clips and their source files will be broken. The archive process needs to take this into account and make sure the _meta.json is updated to adjust the paths to the new filenames.
14. Since we now have a Session videos panel in the player page. I don't think its necessary to ask the user which video they want to open when clicking the "send to player" action button. Let's remove the modal and have the player simply open the first video in the list.
15. lighten up the waveform in the waveform track in the player for non-merged audio so its easier to see.
16. In the thumbnail editor. The work area doesn't clip the items to its boundaries, so items coming off of it show completely. This makes it difficult to determine what the actual thumbnail will look like. Would it be possible to have the parts of a layer that fall outside of the work area have some transparency (so they essentially darken/look faded). If not, just have it crop, showing nothing that falls outside of the boundary.
17. Add a series of inputs in the player clipping mode so the user can finely control the properties of the crop region. located next to the crop dropdown, it should have x, y, w, h (left position, right position, width, height). The x, y will indicate the different in the position from the center of the video to the center of the crop region (if it's to the left, x will be negative, if it's higher up, y will be negative. also add a reset button which will reset the crop to the default position: x: 0, y: 0, width/height: whatever it should be).
18. Rename the comments feature in the stream items to "Notes" instead. Also update the How to Use section.
19. Implement a recreation of the OBS stream picker for YouTube, to allow selection of scheduled streams through OBS. The ultimate goal would be to create a new stream item in the app, and when it's time to stream, the app automatically sends OBS the details for the YouTube connection. Here is what Claude recommended:
    ```
    Option 3: Build the event picker yourself as a custom dock (the real answer)
    OBS supports custom browser docks, and YouTube's Live Streaming API exposes liveBroadcasts.list which returns exactly what OBS's native picker shows — your scheduled events with their bound stream keys. You build a small local web page that:

    Authenticates to the YouTube Data API (OAuth with your Google account, one-time setup).
    Calls liveBroadcasts.list to fetch your upcoming scheduled events.
    Displays them as a dropdown.
    On selection, pulls the stream key via liveStreams.list on the broadcast's bound stream.
    Pushes that key into Aitum's YouTube output via obs-websocket (which Aitum exposes settings for) — or writes directly to Aitum's plugin config file and triggers a reload.

    You host this page locally (file:// or python -m http.server), add it as a Custom Browser Dock in OBS. Now you have a native-looking dock inside OBS with your scheduled events, one click away, and Twitch stays primary the whole time.
    This is the only path that actually achieves what you described. It's a few hours of work: a single HTML page with a Google OAuth flow, three API calls, and either obs-websocket JS or a file write. Given your existing automation chops (the video processing PowerShell stuff), this is well within reach.
    Caveats on option 3:

    You need a Google Cloud project with YouTube Data API v3 enabled to get OAuth credentials. Free. One-time setup, 15 minutes.
    The YouTube Data API has a daily quota (10,000 units default). liveBroadcasts.list costs 1 unit. You won't come close.
    Aitum doesn't publicly document whether its output keys are writable via obs-websocket — it may require editing the plugin's JSON config on disk (in %APPDATA%\obs-studio\plugin_config\) and restarting OBS or toggling the output. Worth confirming before committing to this.
    If Aitum's config isn't easily hot-swappable, the fallback is writing directly to the standard OBS profile's service.json — but that file is only read by OBS's primary service, so you'd be back to needing YouTube as primary.
    ```

## Bugs

1. The app seems to freeze briefly at certain increments. It seems to correspond to YouTube API calls that appear in the VS Code console. These calls seem to happen at certain increments no matter where I am or what I'm doing in the app. Are these calls necessary?:
    ```
    [YT api] GET https://www.googleapis.com/youtube/v3/liveBroadcasts?part=status&id=pbVyDEd1PmY
[YT api] response status: 200
[YT api] GET https://www.googleapis.com/youtube/v3/videos?part=status&id=yHAC7g0vt4g%2CU9g0pa69xJY%2CfukEY6yFBe4%2CNIlhJR3w09E%2CPKE1wlykxo4%2CjxT2WKf1lH0%2CnxoJx3RSGZY%2CwrSg7ONmils%2Ch5ugJ0UknwM%2C2V4-VjT9Xcs%2C0RK9BNcgFXg%2CAq85kRIicI4%2CP8nrfWRFAtw%2CE2vBWYhl7l8%2Ct2NAACYQPnA%2CCstkQlZxof0%2CVtKEDaCiOyY%2C_fa4VUkA4SU%2CLhbxKnRajyc%2CLrl6rvw4cvI%2C1Pqn5mjhF94%2CprHlm9mr3CI%2C6sH90qQaOUI%2CIdTnQRunRaQ%2CCrk0B2bH-Z8%2CdFRVcqptACU%2CAJaCRqQ-BPk%2Cevc1q-qspk0%2CnNai3GByqO4%2Cjr0DXk2SMos%2CQcHTyjknyPI%2CLhbxKnRajyc%2CsIyZEP5rnDQ%2CT9v4ng_WiQ8%2CZqOTExYuSzE%2C8RvhogkNHRE%2CSaoololDjmk%2CMGIf-EJRf9k%2CD36E3I1qFdM%2CapT0hZazF50%2CTShDKiNcdXM%2C-J99CCcuffE%2C-fg4z2Byvps%2CFvgECkEG8GE%2CdsbI6O4rWRM%2Cu_w9NFkv574%2CSWVhv26-7zs%2CQSflFYZ6Fhg%2CtKkwreHiTsg%2CMWSf0YIR3d0&maxResults=50
[YT api] response status: 200
[YT api] response status: 200
[YT api] GET https://www.googleapis.com/youtube/v3/videos?part=status&id=LhbxKnRajyc%2Cbv0mcR79W6E%2C_5XJRDSFr4c%2CD8SIgjdtUc4%2CuHOXV2FvccU%2CVwc5y7SQv58%2CEVZlZ03GE2I%2Cw184P79fxYg%2C_pjsd7iIp6s%2C3gD0HB5ucSU%2CHZKwgP4qVzA%2CHhNnQetGvLU%2Cs0qPsZsR8vY%2C925PeEGOH1A%2CMurblLYRp1o%2CZXMH2b1ZvzQ%2C24x3uKh96ak%2CpIwrEQPA5FA%2CYYgpPbge33g%2CZvnqGJp8P78%2CAbbzHCydCRY%2CVx7k_fMB21Y%2CsVAuZyHuPdM%2Clv5XRjr_bPg%2CluH_gcgU_Rk%2ClKJZr91ChGI%2CCLFvK8BdpvY%2CzpcXlmDPTkk%2C-4djo432YkU%2ChycqBmw3xK0%2CJk3uD5NXANo%2CeVPyt08kTxs%2CkDtjOC7N69M%2CzixuIh6XbAM%2CPwQAWRP2B_0%2CbUPAX7Otwng%2C3_Wxay9haCA%2Cxft1KuJnO9g%2C_kaaxFr6aUA%2CBLj3oODL1zA%2C7UZjQHKRApo%2Cdr7fcobyi2s%2CXyhyR-1OJk8%2Cklzz78Og0x0%2CLuwE26wUNrM%2C2lFbxbzUXxU%2CRo8wGJ1PwEQ%2CfBetSJ0jpzk%2CLhbxKnRajyc%2CEMyrysDIYG4&maxResults=50
[YT api] response status: 200
[YT api] GET https://www.googleapis.com/youtube/v3/videos?part=status&id=aaDO2qepnHE%2CYBoitTOLfFM%2CLhbxKnRajyc%2CQq4g3dbpx_k%2CfHtYBHoMhQI%2CV5V1oGJDg_U%2C8io-oarM_sc%2CWvqKcLjqisU%2CR7rTJrj9E0M%2CztAW1Zy6PN8%2C2fyyJgvmB68%2CN6E92-jkw-s%2CtGXhAKwOHZI%2CWVIAmoIrYag%2Cej2Cf9fp7u4%2C64EE03f_D9E%2C1c1WyoEFxM0%2CRP_1Pko5PYU%2CsDnmiNx7re8%2CqM2KGBvEgvc%2CYmHS4WMCrVc%2ChLnWfIqg0UQ%2Csgvd8BfaOB4%2C9Zd80sfZ8mo%2CmITWu_L7Lk4%2CcrE8hUY5FXA%2CB-XB0pcP2X4%2C-99bLribjBU%2CQYmc1-5bK50%2ClPe3f1uRsWI%2CdhQaYvcOQmg%2Cwl62QaXkjoA%2CFMQqEO-svG4%2CP_x-cnIvxjo%2CZrE5klq6e_4%2CMYimILVu8a4%2C1i269UKI8A8%2CfTUBllAeZEI%2CKyk4QIz5N0s%2COoIaUDL_Na0%2CvHM3i7dqQf0%2Cc70IOyHiz9I%2CFMQqEO-svG4%2CPQKPlxnjUaM%2CFOIVScAuMUY%2CpNkxIPfoiAc%2CGLbxFK3kGHY%2C0bYW-4sMR-g%2CEObvwlPx36c%2CsIlHpHUjE1Q&maxResults=50
[YT api] response status: 200
[YT api] GET https://www.googleapis.com/youtube/v3/videos?part=status&id=Rn3q5kvYaqw&maxResults=50
[YT api] response status: 200
[YT api] GET https://www.googleapis.com/youtube/v3/liveBroadcasts?part=status&id=pbVyDEd1PmY
[YT api] response status: 200
```
