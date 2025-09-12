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
      {/* Intro */}
      <View style={{ marginBottom: 8 }}>
        <Text
          style={{
            fontSize: 16,
            color: '#166534', // green-700
            textAlign: 'center',
            marginTop: 6,
            fontFamily: 'Tektur_400Regular',
          }}
        >
          Test your football knowledge in the ultimate transfer-history guessing game. Can you
          identify the stars (and hidden gems) from their career moves alone?
        </Text>
      </View>

      {/* Feature "Cards" */}
      <Section>
        <CardGrid>
          <FeatureCard emoji="🌟" title="Daily Challenges" text="One global player per day. Guess right to earn a bonus game." />
          <FeatureCard emoji="⚽️" title="Regular Games" text="Play up to 10 games a day with fully customizable difficulty." />
          <FeatureCard emoji="⚔️" title="Private Leagues" text="Challenge friends; daily totals decide matchday wins." />
          <FeatureCard emoji="🪓" title="Elimination Challenges" text="Survive round by round—lowest totals get knocked out on elimination rounds." />
          <FeatureCard emoji="⏱️" title="Time Pressure" text="2 minutes and 3 guesses—points decay over time." />
          <FeatureCard
            emoji="⚙️"
            title="Advanced Filters"
            text="Pick competitions, seasons, a minimum market value, and a minimum appearances filter to tune difficulty."
          />
          <FeatureCard emoji="💡" title="Strategic Hints" text="Age, citizenship, position & image hints—use wisely to preserve points." />
        </CardGrid>
      </Section>

      {/* How It Works */}
      <Section>
        <RowTitle emoji="⚠️" title="How It Works" />
        <Paragraph>
          FootyTrail challenges you to identify professional football players using only their transfer
          history. Each day, you get <Bold>10 regular attempts</Bold> and <Bold>one Daily Challenge attempt</Bold>.
          Win the Daily Challenge to unlock a bonus 11th game.
        </Paragraph>

        <Card>
          <SubTitle>Game Modes</SubTitle>
          <Bullet>
            <Bold>Daily Challenge:</Bold> Everyone faces the same player. Guess correctly to earn a bonus game!
          </Bullet>
          <Bullet>
            <Bold>Regular Game:</Bold> Customize difficulty with <Italic>competitions</Italic>, <Italic>seasons</Italic>, a
            <Italic> minimum market value</Italic>, and a <Italic>minimum appearances</Italic> filter.
          </Bullet>
          <Bullet>
            <Bold>Elimination Challenges:</Bold> Create survival-style tournaments with friends. Scores accumulate across
            rounds and the lowest totals are eliminated on designated elimination rounds.
          </Bullet>
        </Card>

        <Card>
          <SubTitle>Advanced Filtering</SubTitle>
          <Bullet><Bold>Competitions:</Bold> Choose from professional competitions worldwide.</Bullet>
          <Bullet><Bold>Seasons:</Bold> Focus your search on specific seasons.</Bullet>
          <Bullet>
            <Bold>Minimum Market Value (€):</Bold> Only include players whose market value (max across the selected
            seasons) meets or exceeds your threshold.
          </Bullet>
          <Bullet>
            <Bold>Minimum Appearances:</Bold> Only include players who reached at least your appearance threshold across
            the selected seasons.
          </Bullet>
          <Bullet><Bold>Profile Defaults:</Bold> Save your preferred filters to auto-apply for new games.</Bullet>
        </Card>
      </Section>

      {/* Pro Tips */}
      <Section>
        <RowTitle emoji="💡" title="Pro Tips" />
        <Card>
          <SubTitle>Maximize Points</SubTitle>
          <Bullet>Include more competitions for larger player pools and higher potential points.</Bullet>
          <Bullet>
            Tuning difficulty: set a lower <Bold>minimum market value</Bold> and/or a higher <Bold>minimum appearances</Bold> to
            affect pool size and scoring.
          </Bullet>
          <Bullet>Use hints sparingly—first letter hint costs the most.</Bullet>
          <Bullet>Guess quickly to minimize time penalties.</Bullet>
          <Bullet>Win the Daily Challenge to earn a bonus regular game.</Bullet>
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

        <Card>
          <KV label="Base points" value="5 pts × pool size" />
          <KV label="Daily Challenge base points" value="10,000" />
          <KV label="Age / Nationality hint" value="×0.90 each" />
          <KV label="Position hint" value="×0.80" />
          <KV label="Player image hint" value="×0.50" />
          <KV label="First letter hint" value="×0.25" />
          <KV label="Wrong guess penalty" value="×0.66 per wrong guess" />
          <KV label="Time penalty" value="Points decay over time" />
        </Card>

        <InfoBox tone="yellow">
          <Paragraph>
            <Bold>Example:</Bold> 500 players in pool → 2,500 base points. Hints, wrong guesses (×0.66 each), and time
            will adjust your final score—play smart to maximize it!
          </Paragraph>
        </InfoBox>
      </Section>

      {/* Elimination Challenges */}
      <Section>
        <RowTitle emoji="🪓" title="Elimination Challenges" />
        <Card>
          <Bullet>Create public or private elimination tournaments with friends.</Bullet>
          <Bullet>Set <Bold>rounds to elimination</Bold>: after each block, the lowest totals are eliminated.</Bullet>
          <Bullet>Rounds continue until a single winner remains (or as defined by your tournament settings).</Bullet>
          <Bullet>Scores carry over between rounds; every guess matters.</Bullet>
        </Card>
      </Section>

      {/* Private Leagues */}
      <Section>
        <RowTitle emoji="⚔️" title="Private Leagues" />
        <Card>
          <Bullet>Create leagues with 2–20 friends — a bot will be added for odd numbers.</Bullet>
          <Bullet>Your total daily points are compared head-to-head with your opponent’s.</Bullet>
          <Bullet>Win = 3 points, Draw = 1 point each. League tables update live through the day.</Bullet>
          <Bullet>League play is independent of global rankings.</Bullet>
          <Bullet>Fixtures are generated automatically for the whole schedule.</Bullet>
        </Card>
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
          <Text style={{ fontSize: 16, color: '#15803D', textDecorationLine: 'underline', fontFamily: 'Tektur_400Regular' }}>
            footy.trail.app@gmail.com
          </Text>
        </TouchableOpacity>
      </Section>

      {/* Policy & Legal */}
      <Section>
        <SectionTitle>Site Policy & Legal</SectionTitle>
        <Paragraph>
          <Bold>Unofficial Fan Project:</Bold> FootyTrail is a fan-made game and is not affiliated with, endorsed by,
          or sponsored by any football league, club, player, or governing body.
        </Paragraph>
        <Paragraph>
          <Bold>Data Accuracy:</Bold> We strive to keep all information up to date, but we can’t guarantee accuracy,
          completeness, or availability at all times.
        </Paragraph>
        <Paragraph>
          <Bold>Fair Use & Takedowns:</Bold> If you believe any content infringes your rights, please contact us at{' '}
          <Text
            style={{ color: '#15803D', textDecorationLine: 'underline', fontFamily: 'Tektur_400Regular' }}
            onPress={() => Linking.openURL('mailto:footy.trail.app@gmail.com')}
          >
            footy.trail.app@gmail.com
          </Text>{' '}
          with details.
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
  <Text style={{ fontSize: 20, fontWeight: '700', color: '#065F46', marginBottom: 8, fontFamily: 'Tektur_700Bold' }}>{children}</Text>
);

const SubTitle = ({ children }) => (
  <Text style={{ fontSize: 16, fontWeight: '700', color: '#065F46', marginBottom: 6, fontFamily: 'Tektur_700Bold' }}>{children}</Text>
);

const RowTitle = ({ emoji, title }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
    <Text style={{ fontSize: 20, marginRight: 8, fontFamily: 'Tektur_400Regular' }}>{emoji}</Text>
    <Text style={{ fontSize: 20, fontWeight: '700', color: '#065F46', fontFamily: 'Tektur_700Bold' }}>{title}</Text>
  </View>
);

const Paragraph = ({ children, style }) => (
  <Text style={[{ fontSize: 14, color: '#374151', lineHeight: 20, fontFamily: 'Tektur_400Regular' }, style]}>{children}</Text>
);

const Bold = ({ children }) => <Text style={{ fontWeight: '700', fontFamily: 'Tektur_700Bold' }}>{children}</Text>;
const Italic = ({ children }) => <Text style={{ fontStyle: 'italic', fontFamily: 'Tektur_400Regular' }}>{children}</Text>;

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
  <View style={{ gap: 10 }}>{children}</View>
);

const FeatureCard = ({ emoji, title, text }) => (
  <Card>
    <View style={{ alignItems: 'center', marginBottom: 8 }}>
      <View
        style={{
          height: 64,
          width: 64,
          borderRadius: 32,
          backgroundColor: '#DCFCE7',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 28, fontFamily: 'Tektur_400Regular' }}>{emoji}</Text>
      </View>
      <Text style={{ fontSize: 16, fontWeight: '700', color: '#065F46', textAlign: 'center', fontFamily: 'Tektur_700Bold' }}>
        {title}
      </Text>
    </View>
    <Text style={{ fontSize: 14, color: '#4B5563', textAlign: 'center', fontFamily: 'Tektur_400Regular' }}>{text}</Text>
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
    <Text style={{ flex: 1, paddingRight: 8, color: '#374151', fontFamily: 'Tektur_400Regular' }}>{label}</Text>
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
      fontFamily: 'Tektur_400Regular',
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
  <Text style={{ fontSize: 14, color: '#374151', lineHeight: 20, marginBottom: 6, fontFamily: 'Tektur_400Regular' }}>
    • {children}
  </Text>
);
