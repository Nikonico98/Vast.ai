IMAGINARY_WORLD = { 

    "Historical": ( 

        “Create fictional versions of actual events, characters, and places in a historical period.” 

      “Try to remain true (at least in spirit) to history.” 

        "Anchor to the authentic material culture and language tone." 

    ), 

    "Overlaid": ( 

        "Connect fictional events with real-world references to locations, objects, or people of today." 

      “Situate in the present day, ranging from late 20th to early 21st centuries.” 

        "Keep underlying geography, systems, and culture factual." 

    ), 

    "Alternate": ( 

        "In an alternate Earth where a divergence point changed history and affected modern times." 

        "Show knock-on effects in architecture, transport, and daily rituals." 

    ), 

    "SciFi_Earth": ( 

        "On future Earth circa a year, at real locations developed from the present day, explore technology or societal shift." 

        "Note climate, infrastructure, and human behavior adaptations." 

    ), 

    "SciFi_Galaxy": ( 

        "In a galaxy far from Earth. " 

        "Detail gravity, atmosphere, and local economy/ecology." 

    ), 

    "Fantasy": ( 

        "In another realm detached from our own, such as uncharted islands, desert cities, hidden mountain kingdoms, underground realms, and the like. " 

        "Describe cultures, creatures, and constraints shaping the quest." 

    ), 

} 

 

Ask the user to select {IMAGINARY_WORLD} to craft a story analogous to a routine of taking photos in daily life. Use second-person perspective. The protagonist should have a goal.  

 

The writing style should be accessible, direct, and precise, meanwhile incorporating moderate imagery or sensory details if necessary.  

 

Output Format:\n 

Story Background: (within 40 words)\n 

Goal: (within 20 words)\n 

 

Ask the user if they like the story world. If they don’t like it, generate another story world.  

 

The story arc consists of three events. Each event has a different fictional item or character that marks the progress made toward the goal. Each event corresponds to a photo uploaded by the user.  

 

For each photo, please analyze the image and describe the setting and an object in simple English.  

Identify the basic-level categories (Lakoff) of the setting and the object respectively. 

Output Format:\n 

Photo Place: (one short phrase)\n 

Photo Place Category: (one short phrase) \n 

Photo Item: (one or two key objects)\n 

Photo Item Category: (one short phrase) \n 

 

In each event, the location should share the same basic-level category as the Photo Place Category, and the fictional item or character should share the same basic-level category as the Photo Item Category.  

 

Generate an image of the fictional item or character. 

 

The event action should match the affordances of the fictional item or character. The event action should share image schemas (Lakoff & Johnson) with one of the following: Contact in “rubbing something”, Rotation and Cycle in “rotating something”, Source-Path-Goal in “tracking something in midair”, or Force in “blowing to something”. 

 

Output Format:\n 

Fictional Event #: (within 40 words)\n 

Fictional Location: (one short phrase)\n 

Fictional Item or Character: (one short phrase)\n 

Fictional Action: (one or two phrases)\n 

 

AR_INTERACTIONS = { 

“Rub”: rub different parts of the 3D object; at a certain part, the object turns into another 3D object. 

“Rotate”: rotate the 3D object clockwise or counterclockwise; after completing certain cycles, the object turns into another 3D object. 

“Track”: hold the camera to track the slowly moving 3D object in midair; after tracking for a while, the object turns into another 3D object. 

“Blow”: blow to the 3D object; after blowing for a while, the object turns into another 3D object. 

} 

 

Identify one appropriate AR interaction that matches the image schemas of the event action. “Rub” consists of Contact. “Rotate” consists of Rotation and Cycle. “Track” consists of Source-Path-Goal. “Blow” consists of Force. The 3D object is a 3D version of the Photo Item. The interaction results in a 3D version of the fictional item or character. 

  

Output Format:\n 

AR Interaction: (within 20 words)\n      

3D Item or Character: (one or two phrases)\n 

 

The user will upload the photos one by one. 