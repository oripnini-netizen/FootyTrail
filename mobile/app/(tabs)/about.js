import React from 'react';
import { ScrollView, View, Text, Linking, TouchableOpacity } from 'react-native';

export default function AboutPage() {
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        paddingBottom: 48,
        backgroundColor: '#F0FDF4', // green-50 vibe
      }}
    >
      {/* Header */}
      <View style={{ marginBottom: 8 }}>
        <Text
          style={{
            fontSize: 28,
            fontWeight: '800',
            color: '#064E3B', // green-900
            textAlign: 'center',
          }}
        >
          About <Text style={{ color: '#EAB308' /* yellow-500 */ }}>FootyTrail</Text>
        </Text>
        <Text
          style={{
            fontSize: 16,
            color: '#166534', // green-700
            textAlign: 'center',
            marginTop: 6,
          }}
        >
          Test your football knowledge in the ultimate transfer-history guessing game. Can you
          identify the stars (and hidden gems) from their career moves alone?
        </Text>
      </View>

      {/* Feature "Cards" */}
      <Section>
        <SectionTitle>Features</SectionTitle>
        <CardGrid>
          <FeatureCard emoji="🎯" title="Daily Challenge" text="One global player per day. Guess right to earn a bonus game." />
          <FeatureCard emoji="🛡️" title="Regular Game" text="Play up to 10 games a day with fully customizable difficulty." />
          <FeatureCard emoji="👥" title="Private Leagues" text="Challenge friends; daily totals decide matchday wins." />
          <FeatureCard emoji="🪓" title="Elimination Challenges" text="Survive round by round—lowest totals get knocked out on elimination rounds." />
          <FeatureCard emoji="⏱️" title="Time Pressure" text="3 minutes and 3 guesses—points decay over time." />
          <FeatureCard emoji="🧪" title="Advanced Filters" text="Pick competitions, seasons, and a minimum market value to tune difficulty." />
          <FeatureCard emoji="💡" title="Strategic Hints" text="Age, citizenship, position & image hints—use wisely to preserve points." />
        </CardGrid>
      </Section>

      {/* How It Works */}
      <Section>
        <RowTitle emoji="🏆" title="How It Works" />
        <Paragraph>
          FootyTrail challenges you to identify professional football players using only their transfer
          history. Each day, you get <Bold>10 regular attempts</Bold> and <Bold>one Daily Challenge attempt</Bold>.
          Win the Daily Challenge to unlock a bonus 11th game.
        </Paragraph>

        <InfoBox tone="green">
          <Paragraph style={{ marginBottom: 6 }}>
            <Bold>Game Modes:</Bold>
          </Paragraph>
          <Bullet> <Bold>Daily Challenge:</Bold> Everyone faces the same player. Guess correctly to earn a bonus game!</Bullet>
          <Bullet>
            <Bold>Regular Game:</Bold> Customize difficulty with <Italic>competitions</Italic>, <Italic>seasons</Italic>, and a
            <Italic> minimum market value</Italic> filter.
          </Bullet>
          <Bullet><Bold>Rules:</Bold> 3 minutes & 3 guesses per player in all modes.</Bullet>
          <Bullet>
            <Bold>Elimination Challenges:</Bold> Create survival-style tournaments with friends. Scores accumulate across
            rounds and the lowest totals are eliminated on designated elimination rounds.
          </Bullet>
        </InfoBox>

        <InfoBox tone="blue">
          <Paragraph style={{ marginBottom: 6 }}>
            <Bold>Advanced Filtering:</Bold>
          </Paragraph>
          <Bullet><Bold>Competitions:</Bold> Choose from professional competitions worldwide.</Bullet>
          <Bullet><Bold>Seasons:</Bold> Focus your search on specific seasons.</Bullet>
          <Bullet>
            <Bold>Minimum Market Value (€):</Bold> Only include players whose market value (max across the selected
            seasons) meets or exceeds your threshold.
          </Bullet>
          <Bullet><Bold>Profile Defaults:</Bold> Save your preferred filters to auto-apply for new games.</Bullet>
        </InfoBox>
      </Section>

      {/* Pro Tips */}
      <Section>
        <RowTitle emoji="💡" title="Pro Tips" />
        <Card>
          <SubTitle>Maximize Points</SubTitle>
          <Bullet>Include more competitions for larger player pools and higher potential points.</Bullet>
          <Bullet>Set a lower <Bold>minimum market value</Bold> for tougher pools and more points.</Bullet>
          <Bullet>Use hints sparingly—first letter hint costs the most.</Bullet>
          <Bullet>Guess quickly to minimize time penalties.</Bullet>
          <Bullet>Win the Daily Challenge to earn a bonus regular game.</Bullet>
        </Card>
        <Card>
          <SubTitle>League Strategy</SubTitle>
          <Bullet>Consistency beats spikes; your daily total decides league match results.</Bullet>
          <Bullet>Balance safer picks with occasional high-risk plays when chasing points.</Bullet>
          <Bullet>Watch opponents’ typical scores to plan your approach.</Bullet>
        </Card>
      </Section>

      {/* Scoring System */}
      <Section>
        <RowTitle emoji="🥇" title="Scoring System" />
        <Paragraph>
          In regular games, your base points depend on the size of your filtered player pool
          (<Bold>5 points per player</Bold>). Daily challenges start at a fixed <Bold>10,000 points</Bold>. Your final
          score is then modified by hints, wrong guesses, and time.
        </Paragraph>

        {/* Simple "table" */}
        <Card>
          <KV label="Base points" value="5 pts × pool size" />
          <KV label="Daily Challenge base points" value="10,000" />
          <KV label="Age / Nationality hint" value="×0.90 each" />
          <KV label="Position hint" value="×0.80" />
          <KV label="Player image hint" value="×0.50" />
          <KV label="First letter hint" value="×0.25" />
          <KV label="Wrong guess penalty" value="Current points are halved per wrong guess" />
          <KV label="Time penalty" value="Points decay over time" />
        </Card>

        <InfoBox tone="yellow">
          <Paragraph>
            <Bold>Example:</Bold> 500 players in pool → 2,500 base points. Hints, wrong guesses (halving), and time
            will adjust your final score—play smart to maximize it!
          </Paragraph>
        </InfoBox>
      </Section>

      {/* Private Leagues */}
      <Section>
        <RowTitle emoji="👥" title="Private Leagues" />
        <InfoBox tone="blue">
          <Bullet>Create leagues with 2–20 friends — a bot will be added for odd numbers.</Bullet>
          <Bullet>Your total daily points are compared head-to-head with your opponent’s.</Bullet>
          <Bullet>Win = 3 points, Draw = 1 point each. League tables update live through the day.</Bullet>
          <Bullet>League play is independent of global rankings.</Bullet>
          <Bullet>Fixtures are generated automatically for the whole schedule.</Bullet>
        </InfoBox>
      </Section>

      {/* Contact & Support */}
      <Section>
        <SectionTitle>Contact & Support</SectionTitle>
        <Paragraph>
          Found a bug, want to request additional leagues, have feedback, or ran into any other issue? Drop us a line:
        </Paragraph>
        <TouchableOpacity
          onPress={() => Linking.openURL('mailto:footy.trail.app@gmail.com')}
          accessibilityRole="button"
          accessibilityLabel="Email support"
        >
          <Text style={{ fontSize: 16, color: '#15803D', textDecorationLine: 'underline' }}>
            footy.trail.app@gmail.com
          </Text>
        </TouchableOpacity>
      </Section>

      {/* Policy & Legal */}
      <Section>
        <SectionTitle>Site Policy & Legal</SectionTitle>
        <Paragraph>
          <Bold>Unofficial Fan Project:</Bold> FootyTrail is a fan-made game and is not affiliated with, endorsed by,
          or sponsored by any football league, club, player, or governing body. Logos, names, and other marks may be
          the property of their respective owners and are used for identification purposes only.
        </Paragraph>
        <Paragraph>
          <Bold>Data Accuracy:</Bold> We strive to keep all information up to date, but we can’t guarantee accuracy,
          completeness, or availability at all times. The app is provided on an “as is” and “as available” basis,
          without warranties of any kind.
        </Paragraph>
        <Paragraph>
          <Bold>Fair Use & Takedowns:</Bold> If you believe any content infringes your rights, please contact us at{' '}
          <Text
            style={{ color: '#15803D', textDecorationLine: 'underline' }}
            onPress={() => Linking.openURL('mailto:footy.trail.app@gmail.com')}
          >
            footy.trail.app@gmail.com
          </Text>{' '}
          with details, and we’ll review and address it promptly.
        </Paragraph>
        <Paragraph>
          <Bold>Privacy:</Bold> We collect only the information necessary to operate the game (e.g., account and
          gameplay data). We don’t sell personal information. For any privacy questions or data deletion requests, email{' '}
          <Text
            style={{ color: '#15803D', textDecorationLine: 'underline' }}
            onPress={() => Linking.openURL('mailto:footy.trail.app@gmail.com')}
          >
            footy.trail.app@gmail.com
          </Text>.
        </Paragraph>
        <Paragraph>
          <Bold>No Gambling:</Bold> FootyTrail is for entertainment purposes only and does not support wagering or betting.
        </Paragraph>
        <Paragraph>
          <Bold>Age Requirement:</Bold> By using FootyTrail, you confirm that you are at least 13 years old (or the age of
          digital consent in your jurisdiction).
        </Paragraph>
        <Paragraph>
          <Bold>Limitation of Liability:</Bold> To the fullest extent permitted by law, FootyTrail and its creators are not
          liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the app.
        </Paragraph>
      </Section>
    </ScrollView>
  );
}

/* ===== Reusable bits ===== */

const Section = ({ children }) => (
  <View style={{ marginTop: 16 }}>{children}</View>
);

const SectionTitle = ({ children }) => (
  <Text style={{ fontSize: 20, fontWeight: '700', color: '#065F46', marginBottom: 8 }}>{children}</Text>
);

const SubTitle = ({ children }) => (
  <Text style={{ fontSize: 16, fontWeight: '700', color: '#065F46', marginBottom: 6 }}>{children}</Text>
);

const RowTitle = ({ emoji, title }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
    <Text style={{ fontSize: 20, marginRight: 8 }}>{emoji}</Text>
    <Text style={{ fontSize: 20, fontWeight: '700', color: '#065F46' }}>{title}</Text>
  </View>
);

const Paragraph = ({ children, style }) => (
  <Text style={[{ fontSize: 14, color: '#374151', lineHeight: 20 }, style]}>{children}</Text>
);

const Bold = ({ children }) => <Text style={{ fontWeight: '700' }}>{children}</Text>;
const Italic = ({ children }) => <Text style={{ fontStyle: 'italic' }}>{children}</Text>;

const Card = ({ children, style }) => (
  <View
    style={[
      {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        marginBottom: 10,
      },
      style,
    ]}
  >
    {children}
  </View>
);

const CardGrid = ({ children }) => (
  <View style={{ gap: 10 }}>{children}</View> // stacked for mobile; simple and readable
);

const FeatureCard = ({ emoji, title, text }) => (
  <Card>
    <View style={{ alignItems: 'center', marginBottom: 8 }}>
      <View
        style={{
          height: 64,
          width: 64,
          borderRadius: 32,
          backgroundColor: '#DCFCE7', // green-100
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 28 }}>{emoji}</Text>
      </View>
      <Text style={{ fontSize: 16, fontWeight: '700', color: '#065F46', textAlign: 'center' }}>
        {title}
      </Text>
    </View>
    <Text style={{ fontSize: 14, color: '#4B5563', textAlign: 'center' }}>{text}</Text>
  </Card>
);

const KV = ({ label, value }) => (
  <View
    style={{
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: '#F3F4F6',
    }}
  >
    <Text style={{ flex: 1, paddingRight: 8, color: '#374151' }}>{label}</Text>
    <Badge>{value}</Badge>
  </View>
);

const Badge = ({ children }) => (
  <Text
    style={{
      backgroundColor: '#DCFCE7',
      color: '#065F46',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      fontSize: 12,
      overflow: 'hidden',
    }}
  >
    {children}
  </Text>
);

const InfoBox = ({ children, tone = 'green' }) => {
  const tones = {
    green: { bg: '#ECFDF5', border: '#D1FAE5' },
    blue: { bg: '#EFF6FF', border: '#DBEAFE' },
    yellow: { bg: '#FEFCE8', border: '#FDE68A' },
  };
  const c = tones[tone] || tones.green;
  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        marginTop: 8,
        marginBottom: 10,
      }}
    >
      {children}
    </View>
  );
};

const Bullet = ({ children }) => (
  <Text style={{ fontSize: 14, color: '#374151', lineHeight: 20, marginBottom: 6 }}>
    • {children}
  </Text>
);
