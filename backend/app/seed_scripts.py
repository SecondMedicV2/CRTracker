"""STARTER script wording and caller-safety word lists (Part 12). Editable by an admin as rule
sets, pending doctor/native-speaker sign-off (Q19, Q20). Placeholders in {braces} are filled
by the generator; {patient_name}, {caller_name} and {company} are filled only when a caller opens the card."""

SCRIPT_TEMPLATES = {
    "en": {
        "units": {"months": "months", "days": "days", "year_old": "year-old"},
        "headline": "Follow-up due: {tests}",
        "doctor": {
            "opening": "This is a follow-up call for a {age}-year-old patient whose {lab} report is {report_age_text} old. Review the findings below before speaking to the patient.",
            "discussion_points": [
                "Confirm identity and ask how the patient has been since the last test.",
                "Discuss the findings listed above and any lifestyle or treatment changes since then.",
                "Explain why a repeat test is suggested and when it should be done.",
            ],
            "finding": "{name}: {value} {unit} against the reference range {ref_range} ({direction}, {severity}; trend since the previous report: {trend}).",
            "questions_to_ask": [
                "Any new symptoms since the last report?",
                "Are you taking any regular medicines or supplements?",
                "Any change in diet, exercise or weight?",
            ],
            "counselling_points": [
                "Explain the findings in simple terms and what they mean for daily habits.",
                "Stress the importance of repeating the tests on time.",
            ],
            "red_flags": ["Chest pain, breathlessness, fainting, confusion or severe weakness: advise emergency care immediately."],
            "test_line": "{name}: {rationale}",
            "rationale": "Follows up the {bucket} finding from the report dated {report_date}; repeat about {interval_days} days after the original test.",
            "closing": "Thank the patient, confirm the plan for repeat testing and the next follow-up.",
            "next_followup": "Repeat the suggested tests and review again in {interval_days} days.",
        },
        "caller": {
            "opening": "Hello, may I speak with {patient_name}? This is {caller_name} calling from {company}.",
            "identity_check": "Before we continue, could you please confirm your date of birth or the area where you live?",
            "free_followup_pitch": "As part of our service you are eligible for a free follow-up call with one of our doctors after your recent {tests}. There is no charge for this call.",
            "consent_request": "May I have your permission to arrange this call and to share your earlier report with the doctor?",
            "slot_offer": "Which time suits you better, morning or evening? I will book the next available slot for you.",
            "objection_handling": [
                {"objection": "I am busy right now.", "reply": "It is a short call and we can fix a time that suits you."},
                {"objection": "Is it really free?", "reply": "Yes, the follow-up call with the doctor is free as part of our service."},
                {"objection": "I feel fine.", "reply": "That is good to hear. The doctor will simply go over your earlier report and advise whether anything further is needed."},
                {"objection": "What is wrong with my report?", "reply": "I am not able to discuss the report. The doctor will explain everything on the call."},
            ],
            "do_not_say": [
                "Do not explain, interpret or comment on any test result.",
                "Do not name any disease, condition or medicine.",
                "Do not promise any treatment or outcome.",
            ],
            "urgent_symptom_protocol": "If the patient mentions chest pain, difficulty breathing, fainting, severe weakness or any other urgent symptom, advise them to seek emergency care immediately and notify the doctor straight away using the Request escalation button.",
            "closing": "Thank you for your time. The doctor will speak with you at the booked time. Take care.",
        },
    },
    "hi": {
        "units": {"months": "महीने", "days": "दिन", "year_old": "वर्षीय"},
        "headline": "फ़ॉलो-अप देय: {tests}",
        "doctor": {
            "opening": "यह {age} वर्षीय मरीज़ के लिए फ़ॉलो-अप कॉल है, जिनकी {lab} रिपोर्ट {report_age_text} पुरानी है। मरीज़ से बात करने से पहले नीचे दिए निष्कर्ष देख लें।",
            "discussion_points": [
                "पहचान की पुष्टि करें और पूछें कि पिछले टेस्ट के बाद से मरीज़ कैसे रहे।",
                "ऊपर दिए निष्कर्षों और उसके बाद जीवनशैली या इलाज में हुए बदलावों पर चर्चा करें।",
                "समझाएँ कि दोबारा टेस्ट क्यों सुझाया गया है और कब कराना चाहिए।",
            ],
            "finding": "{name}: {value} {unit}, संदर्भ सीमा {ref_range} ({direction}, {severity}; पिछली रिपोर्ट से तुलना: {trend})।",
            "questions_to_ask": [
                "पिछली रिपोर्ट के बाद कोई नए लक्षण?",
                "क्या आप कोई नियमित दवा या सप्लीमेंट ले रहे हैं?",
                "खान-पान, व्यायाम या वज़न में कोई बदलाव?",
            ],
            "counselling_points": [
                "निष्कर्षों को सरल भाषा में समझाएँ और बताएँ कि रोज़मर्रा की आदतों पर इनका क्या असर है।",
                "समय पर दोबारा टेस्ट कराने का महत्व बताएँ।",
            ],
            "red_flags": ["सीने में दर्द, साँस फूलना, बेहोशी, भ्रम या बहुत कमज़ोरी: तुरंत आपातकालीन चिकित्सा की सलाह दें।"],
            "test_line": "{name}: {rationale}",
            "rationale": "{report_date} की रिपोर्ट में {bucket} के निष्कर्ष का फ़ॉलो-अप; मूल टेस्ट के लगभग {interval_days} दिन बाद दोहराएँ।",
            "closing": "मरीज़ को धन्यवाद दें, दोबारा टेस्ट की योजना और अगला फ़ॉलो-अप तय करें।",
            "next_followup": "सुझाए गए टेस्ट दोहराएँ और {interval_days} दिन में फिर समीक्षा करें।",
        },
        "caller": {
            "opening": "नमस्ते, क्या मैं {patient_name} जी से बात कर सकता/सकती हूँ? मैं {caller_name} बोल रहा/रही हूँ, {company} की ओर से।",
            "identity_check": "आगे बढ़ने से पहले, कृपया अपनी जन्मतिथि या रहने का इलाका बताकर पुष्टि करें।",
            "free_followup_pitch": "हमारी सेवा के तहत आपके हालिया {tests} के बाद हमारे डॉक्टर के साथ एक मुफ़्त फ़ॉलो-अप कॉल आपके लिए उपलब्ध है। इस कॉल का कोई शुल्क नहीं है।",
            "consent_request": "क्या आप इस कॉल की व्यवस्था करने और आपकी पिछली रिपोर्ट डॉक्टर के साथ साझा करने की अनुमति देते हैं?",
            "slot_offer": "आपको कौन सा समय सुविधाजनक रहेगा, सुबह या शाम? मैं आपके लिए अगला उपलब्ध स्लॉट बुक कर दूँगा/दूँगी।",
            "objection_handling": [
                {"objection": "मैं अभी व्यस्त हूँ।", "reply": "यह एक छोटी कॉल है और हम आपके सुविधाजनक समय पर तय कर सकते हैं।"},
                {"objection": "क्या यह सच में मुफ़्त है?", "reply": "जी हाँ, डॉक्टर के साथ फ़ॉलो-अप कॉल हमारी सेवा के तहत मुफ़्त है।"},
                {"objection": "मैं ठीक हूँ।", "reply": "यह अच्छी बात है। डॉक्टर बस आपकी पिछली रिपोर्ट देखेंगे और बताएँगे कि आगे कुछ करने की ज़रूरत है या नहीं।"},
                {"objection": "मेरी रिपोर्ट में क्या दिक्कत है?", "reply": "मैं रिपोर्ट पर बात नहीं कर सकता/सकती। डॉक्टर कॉल पर सब कुछ समझाएँगे।"},
            ],
            "do_not_say": [
                "किसी भी टेस्ट रिज़ल्ट को न समझाएँ, न उस पर टिप्पणी करें।",
                "किसी बीमारी, स्थिति या दवा का नाम न लें।",
                "किसी इलाज या नतीजे का वादा न करें।",
            ],
            "urgent_symptom_protocol": "यदि मरीज़ सीने में दर्द, साँस लेने में तकलीफ़, बेहोशी, बहुत कमज़ोरी या कोई अन्य गंभीर लक्षण बताएँ, तो उन्हें तुरंत आपातकालीन चिकित्सा लेने की सलाह दें और Request escalation बटन से तुरंत डॉक्टर को सूचित करें।",
            "closing": "आपके समय के लिए धन्यवाद। डॉक्टर तय समय पर आपसे बात करेंगे। अपना ध्यान रखिए।",
        },
    },
    "hinglish": {
        "units": {"months": "mahine", "days": "din", "year_old": "saal ke"},
        "headline": "Follow-up due: {tests}",
        "doctor": {
            "opening": "Yeh {age} saal ke patient ke liye follow-up call hai, jinki {lab} report {report_age_text} purani hai. Patient se baat karne se pehle neeche diye findings dekh lijiye.",
            "discussion_points": [
                "Identity confirm karein aur poochhein ki pichhle test ke baad patient kaise rahe.",
                "Upar diye findings aur uske baad lifestyle ya treatment mein hue badlav par baat karein.",
                "Samjhayein ki repeat test kyun suggest kiya gaya hai aur kab karana chahiye.",
            ],
            "finding": "{name}: {value} {unit}, reference range {ref_range} ({direction}, {severity}; pichhli report ke mukable trend: {trend}).",
            "questions_to_ask": [
                "Pichhli report ke baad koi naye symptoms?",
                "Kya aap koi regular medicine ya supplement le rahe hain?",
                "Diet, exercise ya weight mein koi badlav?",
            ],
            "counselling_points": [
                "Findings ko saral bhasha mein samjhayein aur batayein ki rozmarra ki aadaton par inka kya asar hai.",
                "Samay par repeat test karane ka mahatva batayein.",
            ],
            "red_flags": ["Seene mein dard, saans phoolna, behoshi, confusion ya bahut kamzori: turant emergency care ki salah dein."],
            "test_line": "{name}: {rationale}",
            "rationale": "{report_date} ki report ke {bucket} finding ka follow-up; original test ke lagbhag {interval_days} din baad repeat karein.",
            "closing": "Patient ko dhanyavaad dein, repeat test ka plan aur agla follow-up tay karein.",
            "next_followup": "Suggested tests repeat karein aur {interval_days} din mein phir review karein.",
        },
        "caller": {
            "opening": "Namaste, kya main {patient_name} ji se baat kar sakta/sakti hoon? Main {caller_name} bol raha/rahi hoon, {company} ki taraf se.",
            "identity_check": "Aage badhne se pehle, kripya apni date of birth ya rehne ka area bata kar confirm karein.",
            "free_followup_pitch": "Hamari service ke tahat aapke recent {tests} ke baad hamare doctor ke saath ek free follow-up call aapke liye available hai. Is call ka koi charge nahi hai.",
            "consent_request": "Kya aap is call ko arrange karne aur apni pichhli report doctor ke saath share karne ki permission dete hain?",
            "slot_offer": "Aapko kaun sa time suit karega, subah ya shaam? Main aapke liye agla available slot book kar dunga/dungi.",
            "objection_handling": [
                {"objection": "Main abhi busy hoon.", "reply": "Yeh ek chhoti call hai aur hum aapke suitable time par fix kar sakte hain."},
                {"objection": "Kya yeh sach mein free hai?", "reply": "Ji haan, doctor ke saath follow-up call hamari service ke tahat free hai."},
                {"objection": "Main theek hoon.", "reply": "Yeh achhi baat hai. Doctor bas aapki pichhli report dekhenge aur batayenge ki aage kuch karne ki zaroorat hai ya nahi."},
                {"objection": "Meri report mein kya problem hai?", "reply": "Main report par baat nahi kar sakta/sakti. Doctor call par sab kuch samjhayenge."},
            ],
            "do_not_say": [
                "Kisi bhi test result ko explain ya comment na karein.",
                "Kisi bimari, condition ya medicine ka naam na lein.",
                "Kisi treatment ya result ka vaada na karein.",
            ],
            "urgent_symptom_protocol": "Agar patient seene mein dard, saans lene mein takleef, behoshi, bahut kamzori ya koi aur urgent symptom batayein, to unhein turant emergency care lene ki salah dein aur Request escalation button se doctor ko turant inform karein.",
            "closing": "Aapke samay ke liye dhanyavaad. Doctor tay samay par aapse baat karenge. Apna khayal rakhiye.",
        },
    },
}

# Words a caller must never say (Part 12.5). Starter list: a doctor extends it (Q4/Q20).
CALLER_FORBIDDEN = {
    "diagnosis_terms": [
        "diabetes", "diabetic", "prediabetes", "prediabetic", "hypertension", "cancer", "tumor", "tumour", "malignant",
        "anaemia", "anemia", "hypothyroidism", "hyperthyroidism", "kidney disease", "kidney failure", "liver disease",
        "fatty liver", "abnormal", "elevated", "high", "low", "critical", "risk", "deficiency", "deficient", "sugar",
        "मधुमेह", "डायबिटीज", "शुगर", "कैंसर", "असामान्य",
    ],
    "drug_terms": [
        "metformin", "insulin", "statin", "atorvastatin", "rosuvastatin", "glimepiride", "levothyroxine", "thyronorm",
        "amlodipine", "telmisartan", "aspirin", "paracetamol", "medicine", "medicines", "medication", "tablet", "tablets",
        "dose", "दवा", "दवाई",
    ],
}
