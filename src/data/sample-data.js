import { repairDemoVideoSources } from '../media/demo-sources.js';

export const currentUser = {
    name: "Mila Rose",
    handle: "@mila_rose",
    bio: "Design storyteller ✨ Finding beauty in little things.",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80",
    isPrivate: false
};
export const posts = [
    {
        id: 1,
        user: "Ari Bloom",
        handle: "@aribloom",
        location: "Santorini, Greece",
        avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80",
        media: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
        mediaType: "photo",
        caption: "Sun-washed mornings, salty air, and the kind of quiet that makes your mind breathe again. #slowliving #seaside",
        likes: 1834,
        views: 88700,
        comments: 74,
        liked: true,
        commentItems: [
            { user: "Noah Vale", handle: "@noahvale", text: "This light is unreal ✨", followsMe: true, following: true },
            { user: "Ava Kim", handle: "@avakim", text: "Adding this to my travel list!", followsMe: false, following: true },
            { user: "Maya Chen", handle: "@mayatravels", text: "Such a peaceful view.", followsMe: false, following: false }
        ],
        followed: true,
        public: true,
        reel: false
    },
    {
        id: 2,
        user: "Noah Vale",
        handle: "@noahvale",
        location: "Kyiv Studio",
        avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80",
        media: "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80",
        mediaType: "photo",
        caption: "A tiny creative corner, a cup of espresso, and a playlist for deep focus. Detail is everything.",
        likes: 2640,
        views: 102400,
        comments: 86,
        liked: false,
        commentItems: [
            { user: "Ari Bloom", handle: "@aribloom", text: "Need a corner like this in my life.", followsMe: true, following: true },
            { user: "Laia Moreau", handle: "@laia.m", text: "Love the warm tones here.", followsMe: true, following: false },
            { user: "Theo James", handle: "@theo.frames", text: "Great setup!", followsMe: false, following: false }
        ],
        followed: true,
        public: true,
        reel: false
    },
    {
        id: 3,
        user: "Lena Hart",
        handle: "@lenahart",
        location: "Seoul",
        avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=200&q=80",
        media: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80",
        mediaType: "photo",
        caption: "Finding magic in motion — city lights, neon reflections, and one unforgettable night. #nightwalk",
        likes: 4128,
        views: 245100,
        comments: 97,
        liked: false,
        commentItems: [
            { user: "Ava Kim", handle: "@avakim", text: "The colors are gorgeous.", followsMe: true, following: true },
            { user: "Noah Vale", handle: "@noahvale", text: "That neon reflection!", followsMe: false, following: true }
        ],
        followed: false,
        public: true,
        reel: false
    },
    {
        id: 4,
        user: "Maya Chen",
        handle: "@mayatravels",
        location: "Dolomites, Italy",
        avatar: "https://images.unsplash.com/photo-1546961329-78bef0414d7c?auto=format&fit=crop&w=200&q=80",
        media: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80",
        mediaType: "photo",
        caption: "A trail, a thermos of tea, and a view worth the early start. #mountainair",
        likes: 936,
        views: 62000,
        comments: 32,
        liked: false,
        commentItems: [
            { user: "Mila Rose", handle: currentUser.handle, text: "Adding this trail to my list.", followsMe: true, following: true }
        ],
        followed: false,
        public: true,
        reel: false
    },
    {
        id: 5,
        user: "Theo James",
        handle: "@theo.frames",
        location: "Lisbon",
        avatar: "https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=200&q=80",
        media: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1200&q=80",
        videoUrl: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
        mediaType: "video",
        caption: "A little city light study after the rain. #streetphotography",
        likes: 1570,
        views: 131500,
        comments: 41,
        liked: false,
        commentItems: [
            { user: "Mila Rose", handle: currentUser.handle, text: "The reflections came out beautifully.", followsMe: true, following: true }
        ],
        followed: false,
        public: true,
        reel: false
    },
    {
        id: 6,
        user: "Nia Okafor",
        handle: "@nia.makes",
        location: "Accra",
        avatar: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80",
        media: "https://images.unsplash.com/photo-1531058020387-3be344556be6?auto=format&fit=crop&w=1200&q=80",
        mediaType: "photo",
        caption: "Color studies from a slow Sunday in the studio. #artprocess",
        likes: 721,
        views: 25000,
        comments: 25,
        liked: false,
        commentItems: [
            { user: "Laia Moreau", handle: "@laia.m", text: "These colors are so joyful!", followsMe: true, following: true },
            { user: "Theo James", handle: "@theo.frames", text: "Beautiful work.", followsMe: false, following: false }
        ],
        followed: false,
        public: false,
        reel: false
    },
    {
        id: 7,
        user: currentUser.name,
        handle: currentUser.handle,
        location: "Home studio",
        avatar: currentUser.avatar,
        media: "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1200&q=80",
        mediaType: "photo",
        caption: "A fresh page and a quiet morning to fill it.",
        likes: 83,
        views: 42100,
        comments: 12,
        liked: false,
        commentItems: [
            { user: "Ava Kim", handle: "@avakim", text: "Love this little moment.", followsMe: true, following: true }
        ],
        followed: false,
        public: true,
        reel: false,
        mine: true
    },
    {
        id: 8,
        user: currentUser.name,
        handle: currentUser.handle,
        location: "Vancouver",
        avatar: currentUser.avatar,
        media: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=80",
        mediaType: "photo",
        caption: "A weekend outside the city. #weekendnotes",
        likes: 126,
        views: 115200,
        comments: 19,
        liked: false,
        commentItems: [
            { user: "Noah Vale", handle: "@noahvale", text: "That lake is incredible.", followsMe: true, following: true }
        ],
        followed: false,
        public: true,
        reel: false,
        mine: true
    }
];
export const reels = [
    {
        id: 101,
        user: "Lena Hart",
        handle: "@lenahart",
        avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=200&q=80",
        poster: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
        video: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
        caption: "A few frames from a night out in Seoul ✨ #nightwalk",
        likes: 2918,
        views: 321000,
        comments: 48,
        liked: false,
        commentItems: [
            { user: "Ava Kim", handle: "@avakim", text: "The city looks magical!", followsMe: true, following: true, likes: 2 },
            { user: "Noah Vale", handle: "@noahvale", text: "Love these colors.", followsMe: false, following: true, likes: 0 }
        ],
        public: true
    },
    {
        id: 102,
        user: "Theo James",
        handle: "@theo.frames",
        avatar: "https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=200&q=80",
        poster: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
        video: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
        caption: "Golden hour on the open road. #travel",
        likes: 1830,
        views: 192000,
        comments: 26,
        liked: false,
        commentItems: [
            { user: "Mila Rose", handle: currentUser.handle, text: "This is such a good escape.", followsMe: true, following: true, likes: 1 }
        ],
        public: true
    },
    {
        id: 103,
        user: "Private account",
        handle: "@private.creator",
        avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80",
        poster: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80",
        video: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
        caption: "Only visible to followers.",
        likes: 900,
        views: 75000,
        comments: 12,
        liked: false,
        commentItems: [],
        public: false
    }
];
export const demoViewCounts = new Map([...posts, ...reels].map(item => [item.id, item.views || 0]));
repairDemoVideoSources([...posts, ...reels]);
export const communities = [
    {
        id: "travel-stories",
        name: "Travel Stories",
        description: "Share favorite places, memorable trips, and travel inspiration.",
        members: 12400,
        postIds: [1, 3, 4, 8],
        reelIds: [101, 102]
    },
    {
        id: "street-photography",
        name: "Street Photography",
        description: "A community for city scenes, light studies, and candid moments.",
        members: 8700,
        postIds: [3, 5, 6],
        reelIds: [101]
    },
    {
        id: "creative-spaces",
        name: "Creative Spaces",
        description: "Studios, work corners, and the places where ideas take shape.",
        members: 5200,
        postIds: [2, 6, 7],
        reelIds: []
    }
];
export const sampleUploadTime = Date.now();
[...reels].forEach((reel) => { reel.reel = true; });
[...posts, ...reels].forEach((item, index) => {
    if (!Number.isFinite(item.createdAt))
        item.createdAt = sampleUploadTime - index * 60000;
});
export const initialStories = [
    {
        id: "ari-story-1",
        handle: "@aribloom",
        user: "Ari Bloom",
        avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80",
        type: "image",
        media: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
        caption: "Morning in Santorini",
        durationMs: 30000
    },
    {
        id: "ari-story-2",
        handle: "@aribloom",
        user: "Ari Bloom",
        avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80",
        type: "image",
        media: "https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=1200&q=80",
        caption: "A little more of the island",
        durationMs: 30000
    },
    {
        id: "noah-story-1",
        handle: "@noahvale",
        user: "Noah Vale",
        avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80",
        type: "video",
        media: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
        caption: "A short studio tour"
    }
];
export const conversations = [
    {
        user: "Laia Moreau",
        handle: "@laia.m",
        avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80",
        lastMessage: "That place looks amazing! We should go sometime.",
        time: "2m",
        lastActivity: Date.now() - 2 * 60000,
        pinned: false,
        muted: false,
        unread: false,
        messages: [
            { id: "laia-1", type: "text", from: "them", text: "I loved the photos from your trip!", sentAt: Date.now() - 18 * 60000 },
            { id: "laia-2", type: "text", from: "me", text: "It was such a beautiful place.", sentAt: Date.now() - 15 * 60000 },
            { id: "laia-3", type: "text", from: "them", text: "That place looks amazing! We should go sometime.", sentAt: Date.now() - 2 * 60000 }
        ]
    },
    {
        user: "Noah Vale",
        handle: "@noahvale",
        avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80",
        lastMessage: "Sent you the photos from the studio 📷",
        time: "1h",
        lastActivity: Date.now() - 60 * 60000,
        pinned: false,
        muted: false,
        unread: true,
        messages: [
            { id: "noah-1", type: "text", from: "me", text: "How did you set up the lighting?", sentAt: Date.now() - 75 * 60000 },
            { id: "noah-2", type: "text", from: "them", text: "Sent you the photos from the studio 📷", sentAt: Date.now() - 60 * 60000 },
            { id: "noah-3", type: "meme", from: "them", media: posts[2].media, caption: "This is the mood today 😄", sentAt: Date.now() - 58 * 60000 }
        ]
    },
    {
        user: "Ava Kim",
        handle: "@avakim",
        avatar: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=200&q=80",
        lastMessage: "Thanks for the lovely note!",
        time: "Yesterday",
        lastActivity: Date.now() - 24 * 60 * 60000,
        pinned: false,
        muted: false,
        unread: false,
        messages: [
            { id: "ava-1", type: "call", from: "me", direction: "outgoing", media: "voice", duration: "8 min", sentAt: Date.now() - 25 * 60 * 60000 },
            { id: "ava-2", type: "text", from: "them", text: "Your kind words made my day 💜", sentAt: Date.now() - 24 * 60 * 60000 },
            { id: "ava-3", type: "text", from: "me", text: "Thanks for the lovely note!", sentAt: Date.now() - 24 * 60 * 60000 + 60000 }
        ]
    }
];
